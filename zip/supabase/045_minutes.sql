-- =====================================================================
-- 045 · Meeting minutes (22 Nov)
-- Richard: copy the DBP Minutes app (dbp-mint.firebaseapp.com) exactly,
-- rebuilt inside this app so its action points feed the job's To do, the
-- bell and permissions. Existing minutes are not brought across.
-- - meetings: a job's (job_id) or not tied to a job (job_id empty); project
--   name, sub-title and date, as in DBP Minutes
-- - meeting_attendees: staff logins (profile_id) or anyone typed in (name,
--   company, email); "in attendance" or "referenced only"; their @initials
-- - meeting_points: the notes, in order. A point is a note or a section
--   heading; it can be an action with an owner (an attendee) and a due date,
--   be done, urgent or "£ cost impact" (in the app only, never exported), and
--   carries an update log and where it was carried forward from
-- - an action whose owner is a staff login goes on that person's bell (and
--   emails, once send-emails is set up), dated when it's due. Changing the
--   owner or due date moves it; ticking the action done, or carrying it
--   forward to the next meeting, closes it. Done on the bell ticks the action
-- - my_minutes_actions(): the open actions on my bell, across all jobs, for
--   My tasks (everyone, whatever their profile type)
-- - complete_minutes_action(): ticks an action done (or not done): its owner,
--   or anyone who can open Minutes
-- - a new part of the app in Settings › Access, "Job › Minutes". Starting
--   ticks: Project manager, Commercial, Site management, Design
-- - an archived job's minutes are read-only, like everything else on it (042)
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

create table if not exists meetings (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid references jobs(id) on delete cascade,          -- empty = not tied to a job
  project       text not null default '',                            -- "Untitled project" when blank
  subtitle      text not null default '',
  meeting_date  date not null default current_date,
  created_by    uuid references profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists meetings_job on meetings (job_id, meeting_date desc);
drop trigger if exists t_meetings_upd on meetings;
create trigger t_meetings_upd before update on meetings for each row execute function set_updated_at();

create table if not exists meeting_attendees (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references meetings(id) on delete cascade,
  job_id        uuid references jobs(id) on delete cascade,          -- copied from the meeting
  profile_id    uuid references profiles(id) on delete set null,     -- a staff login; empty = typed in
  name          text not null,
  initials      text not null,                                       -- what @mentions use, e.g. AK
  company       text,
  email         text,
  present       boolean not null default true,                       -- false = referenced only
  sort          integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists meeting_attendees_meeting on meeting_attendees (meeting_id, sort);
create index if not exists meeting_attendees_job on meeting_attendees (job_id);

create table if not exists meeting_points (
  id                 uuid primary key default gen_random_uuid(),
  meeting_id         uuid not null references meetings(id) on delete cascade,
  job_id             uuid references jobs(id) on delete cascade,     -- copied from the meeting
  sort               integer not null default 0,
  type               text not null default 'note' check (type in ('note', 'heading')),
  text               text not null default '',
  is_action          boolean not null default false,
  owner_attendee_id  uuid references meeting_attendees(id) on delete set null,
  owner_profile_id   uuid references profiles(id) on delete set null, -- worked out from the owner (below)
  due_date           date,
  done               boolean not null default false,
  done_at            timestamptz,
  urgent             boolean not null default false,
  cost_flag          boolean not null default false,                 -- in the app only, never exported
  updates            jsonb not null default '[]'::jsonb,             -- [{id, date, text}], oldest first
  carried_from       jsonb,                                          -- {meetingId, pointId, project, date}
  carried_forward    boolean not null default false,                 -- taken on to the next meeting
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists meeting_points_meeting on meeting_points (meeting_id, sort);
create index if not exists meeting_points_open on meeting_points (job_id) where is_action and not done and not carried_forward;
create index if not exists meeting_points_owner on meeting_points (owner_profile_id) where is_action and not done and not carried_forward;
drop trigger if exists t_meeting_points_upd on meeting_points;
create trigger t_meeting_points_upd before update on meeting_points for each row execute function set_updated_at();

-- attendees and points are filed under their meeting's job (for the archived-job rules and the job's To do)
create or replace function public.meeting_child_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.job_id := (select job_id from meetings where id = new.meeting_id);
  return new;
end $$;
drop trigger if exists meeting_attendee_job on meeting_attendees;
create trigger meeting_attendee_job before insert or update on meeting_attendees for each row execute function public.meeting_child_job();

-- a point: its job, its owner's login and when it was ticked done
create or replace function public.meeting_point_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.job_id := (select job_id from meetings where id = new.meeting_id);
  new.owner_profile_id := (select profile_id from meeting_attendees where id = new.owner_attendee_id);
  if not new.done then
    new.done_at := null;
  elsif tg_op = 'INSERT' or not old.done then
    new.done_at := coalesce(new.done_at, now());
  end if;
  return new;
end $$;
drop trigger if exists meeting_point_fill on meeting_points;
create trigger meeting_point_fill before insert or update on meeting_points for each row execute function public.meeting_point_fill();

-- the bell reminder for one point, as it stands now: an open action with a staff owner has one (on the owner's
-- bell, dated when due); anything else has none
create or replace function public.refresh_minutes_action(p meeting_points) returns void
language plpgsql security definer set search_path = public as $$
declare
  m meetings;
  j jobs;
  a record;
  t text;
  existing uuid;
  carried_emailed timestamptz;
  v_title text;
  v_detail text;
  v_link text;
begin
  if not (p.type = 'note' and p.is_action and not p.done and not p.carried_forward and p.owner_profile_id is not null) then
    update notifications set status = 'done'
     where source_table = 'meeting_points' and source_id = p.id and kind = 'minutes_action' and status <> 'done';
    return;
  end if;

  select * into m from meetings where id = p.meeting_id;
  select * into j from jobs where id = m.job_id;
  -- @AK reads as the attendee's name, as in the exports
  t := coalesce(nullif(btrim(p.text), ''), '(no description)');
  for a in select initials, name from meeting_attendees where meeting_id = p.meeting_id order by length(initials) desc loop
    t := regexp_replace(t, '@' || regexp_replace(a.initials, '([^A-Za-z0-9])', '\\\1', 'g') || '(?![A-Za-z0-9])', replace(a.name, '\', '\\'), 'gi');
  end loop;
  v_title := coalesce(j.job_no || ' ' || j.code || ' ', '') || 'Action: ' || left(t, 140);
  v_detail := 'From the minutes: ' || coalesce(nullif(btrim(m.project), ''), 'Untitled project') || coalesce(' · ' || nullif(btrim(m.subtitle), ''), '')
              || ', ' || to_char(m.meeting_date, 'DD/MM/YYYY') || case when p.urgent then ' · Urgent' else '' end;
  v_link := case when m.job_id is null then '/minutes/' || m.id else '/jobs/' || m.job_id || '/minutes/' || m.id end;

  -- owner changed: the previous owner's reminder closes
  update notifications set status = 'done'
   where source_table = 'meeting_points' and source_id = p.id and kind = 'minutes_action' and status <> 'done'
     and profile_id is distinct from p.owner_profile_id;

  select id into existing from notifications
   where source_table = 'meeting_points' and source_id = p.id and kind = 'minutes_action' and profile_id = p.owner_profile_id and status <> 'done'
   limit 1;
  if existing is not null then
    update notifications set title = v_title, detail = v_detail, due_date = p.due_date, link = v_link, job_id = m.job_id where id = existing;
  else
    -- carried forward from last meeting: already emailed then, so not emailed again
    if p.carried_from ? 'pointId' and (p.carried_from->>'pointId') ~ '^[0-9a-fA-F-]{36}$' then
      select n.emailed_at into carried_emailed from notifications n
       where n.source_table = 'meeting_points' and n.source_id = (p.carried_from->>'pointId')::uuid and n.profile_id = p.owner_profile_id
       order by n.created_at desc limit 1;
    end if;
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id, emailed_at)
    values (p.owner_profile_id, m.job_id, 'minutes_action', v_title, v_detail, p.due_date, v_link, 'meeting_points', p.id, carried_emailed);
  end if;
end $$;
-- used by the triggers below only: not callable from the app
revoke execute on function public.refresh_minutes_action(meeting_points) from public, anon, authenticated;

create or replace function public.meeting_point_action() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update notifications set status = 'done'
     where source_table = 'meeting_points' and source_id = old.id and kind = 'minutes_action' and status <> 'done';
    return old;
  end if;
  if tg_op = 'UPDATE'
     and (new.type, new.text, new.is_action, new.done, new.carried_forward, new.owner_profile_id, new.due_date, new.urgent)
         is not distinct from (old.type, old.text, old.is_action, old.done, old.carried_forward, old.owner_profile_id, old.due_date, old.urgent) then
    return new;
  end if;
  perform public.refresh_minutes_action(new);
  return new;
end $$;
drop trigger if exists meeting_point_action on meeting_points;
create trigger meeting_point_action after insert or update or delete on meeting_points for each row execute function public.meeting_point_action();

-- a meeting moved to another job, renamed or re-dated: its attendees and points follow, and the reminders say so
create or replace function public.meeting_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p meeting_points;
begin
  if new.job_id is distinct from old.job_id then
    update meeting_attendees set job_id = new.job_id where meeting_id = new.id;
    update meeting_points set job_id = new.job_id where meeting_id = new.id;
  end if;
  if (new.project, new.subtitle, new.meeting_date, new.job_id) is distinct from (old.project, old.subtitle, old.meeting_date, old.job_id) then
    for p in select * from meeting_points where meeting_id = new.id and is_action and not done and not carried_forward and owner_profile_id is not null loop
      perform public.refresh_minutes_action(p);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists meeting_changed on meetings;
create trigger meeting_changed after update on meetings for each row execute function public.meeting_changed();

-- an attendee linked to a different login: the actions they own follow
create or replace function public.meeting_attendee_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.profile_id is distinct from old.profile_id then
    update meeting_points set owner_profile_id = new.profile_id where owner_attendee_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists meeting_attendee_changed on meeting_attendees;
create trigger meeting_attendee_changed after update on meeting_attendees for each row execute function public.meeting_attendee_changed();

-- Done on the bell ticks the action (only while it's still that person's open action: closing a reminder because
-- the owner changed or it was carried forward doesn't)
create or replace function public.minutes_action_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'minutes_action' and new.source_table = 'meeting_points' and new.status = 'done' and old.status <> 'done' then
    update meeting_points set done = true, is_action = false
     where id = new.source_id and type = 'note' and is_action and not done and not carried_forward
       and owner_profile_id = new.profile_id and (job_id is null or not public.job_archived(job_id));
  end if;
  return new;
end $$;
drop trigger if exists minutes_action_done on notifications;
create trigger minutes_action_done after update of status on notifications for each row execute function public.minutes_action_done();

-- who can read and change minutes: signed-in staff, as ticked in Settings › Access; archived jobs read-only
alter table meetings enable row level security;
alter table meeting_attendees enable row level security;
alter table meeting_points enable row level security;
do $$
declare t text;
begin
  foreach t in array array['meetings', 'meeting_attendees', 'meeting_points'] loop
    execute format('drop policy if exists "signed-in users" on public.%I', t);
    execute format('create policy "signed-in users" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('drop policy if exists "access grid" on public.%I', t);
    execute format('create policy "access grid" on public.%I as restrictive for all to authenticated using (public.has_access(''job_minutes'')) with check (public.has_access(''job_minutes''))', t);
    execute format('drop policy if exists "archived job: no adding" on public.%I', t);
    execute format('drop policy if exists "archived job: no changes" on public.%I', t);
    execute format('drop policy if exists "archived job: no deleting" on public.%I', t);
    execute format('create policy "archived job: no adding" on public.%I as restrictive for insert to authenticated with check (job_id is null or not public.job_archived(job_id))', t);
    execute format('create policy "archived job: no changes" on public.%I as restrictive for update to authenticated using (job_id is null or not public.job_archived(job_id)) with check (job_id is null or not public.job_archived(job_id))', t);
    execute format('create policy "archived job: no deleting" on public.%I as restrictive for delete to authenticated using (job_id is null or not public.job_archived(job_id))', t);
  end loop;
end $$;
grant select, insert, update, delete on meetings, meeting_attendees, meeting_points to authenticated;

-- My tasks: my open actions across all jobs (everyone, even without Minutes ticked)
create or replace function public.my_minutes_actions()
returns table (
  point_id uuid, meeting_id uuid, job_id uuid, text text, due_date date, urgent boolean, updates jsonb,
  project text, subtitle text, meeting_date date, job_no integer, job_code text, job_name text, job_status text, attendees jsonb
)
language sql stable security definer set search_path = public as $$
  select p.id, m.id, m.job_id, p.text, p.due_date, p.urgent, p.updates,
         m.project, m.subtitle, m.meeting_date, j.job_no::integer, j.code::text, j.name::text, j.status::text,
         coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'initials', a.initials) order by a.sort)
                   from meeting_attendees a where a.meeting_id = m.id), '[]'::jsonb)
  from meeting_points p
  join meetings m on m.id = p.meeting_id
  left join jobs j on j.id = m.job_id
  where p.owner_profile_id = auth.uid() and p.type = 'note' and p.is_action and not p.done and not p.carried_forward
$$;
grant execute on function public.my_minutes_actions() to authenticated;

-- tick an action done (or not done): its owner, or anyone who can open Minutes; not on an archived job
create or replace function public.complete_minutes_action(point uuid, is_done boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  p meeting_points;
begin
  select * into p from meeting_points where id = point;
  if p.id is null then raise exception 'That action has been deleted.'; end if;
  if not (coalesce(p.owner_profile_id = auth.uid(), false) or public.has_access('job_minutes')) then
    raise exception 'Only the action''s owner, or someone who can open Minutes, can tick it.';
  end if;
  if p.job_id is not null and public.job_archived(p.job_id) then
    raise exception 'This job is archived (read-only). An admin can unarchive it to make changes.';
  end if;
  update meeting_points set done = is_done, is_action = not is_done where id = point;
end $$;
grant execute on function public.complete_minutes_action(uuid, boolean) to authenticated;

-- starting ticks in Settings › Access (admins and anyone with no type yet see Minutes anyway)
insert into role_access (role, section) values
  ('project_manager', 'job_minutes'), ('commercial', 'job_minutes'), ('site_management', 'job_minutes'), ('design', 'job_minutes')
on conflict do nothing;
