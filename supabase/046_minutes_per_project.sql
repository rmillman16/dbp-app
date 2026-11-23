-- =====================================================================
-- 046 · Minutes live in each job or estimate (23 Nov)
-- Richard, after trying 045: "minutes live within projects". Run after 045.
-- - a meeting belongs to a job or to an Estimating enquiry (tender meetings),
--   never both. There's no list of meetings outside a job or an estimate
--   any more (any made under 045 with neither stay, but can't be changed)
-- - who sees them: a job's minutes as ticked for Job › Minutes; an
--   estimate's as ticked for Estimating. Attendees and points follow their
--   meeting
-- - an estimate's actions go on the owner's bell too, titled with the
--   enquiry (E012 …) and linked to the estimate's minutes
-- - when an enquiry is won and set up as a job, its meetings move to the
--   job (with their bell reminders)
-- - My tasks and ticking an action done work for estimates as well
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

alter table meetings add column if not exists enquiry_id uuid references enquiries(id) on delete cascade;
create index if not exists meetings_enquiry on meetings (enquiry_id, meeting_date desc);

-- a job's or an estimate's, not both (checked on new and changed meetings; any older ones with neither are left be)
alter table meetings drop constraint if exists meetings_job_or_enquiry;
alter table meetings add constraint meetings_job_or_enquiry
  check ((job_id is not null) <> (enquiry_id is not null)) not valid;
do $$
begin
  if not exists (select 1 from meetings where (job_id is not null) = (enquiry_id is not null)) then
    alter table meetings validate constraint meetings_job_or_enquiry;
  end if;
end $$;

-- who sees what: an estimate's meetings follow Estimating, a job's follow Job › Minutes; attendees and points
-- follow their meeting (the meetings rule applies inside the check)
drop policy if exists "access grid" on meetings;
create policy "access grid" on meetings as restrictive for all to authenticated
  using (case when enquiry_id is not null then public.has_access('estimating') else public.has_access('job_minutes') end)
  with check (case when enquiry_id is not null then public.has_access('estimating') else public.has_access('job_minutes') end);
drop policy if exists "access grid" on meeting_attendees;
create policy "access grid" on meeting_attendees as restrictive for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id))
  with check (exists (select 1 from meetings m where m.id = meeting_id));
drop policy if exists "access grid" on meeting_points;
create policy "access grid" on meeting_points as restrictive for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id))
  with check (exists (select 1 from meetings m where m.id = meeting_id));

-- the bell reminder for one point (as 045, plus estimates: no job, titled with the enquiry, linked to its minutes)
create or replace function public.refresh_minutes_action(p meeting_points) returns void
language plpgsql security definer set search_path = public as $$
declare
  m meetings;
  j jobs;
  e enquiries;
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
  select * into e from enquiries where id = m.enquiry_id;
  t := coalesce(nullif(btrim(p.text), ''), '(no description)');
  for a in select initials, name from meeting_attendees where meeting_id = p.meeting_id order by length(initials) desc loop
    t := regexp_replace(t, '@' || regexp_replace(a.initials, '([^A-Za-z0-9])', '\\\1', 'g') || '(?![A-Za-z0-9])', replace(a.name, '\', '\\'), 'gi');
  end loop;
  v_title := coalesce(j.job_no || ' ' || j.code || ' ', 'E' || lpad(e.enquiry_no::text, 3, '0') || ' ', '') || 'Action: ' || left(t, 140);
  v_detail := 'From the minutes' || coalesce(' (' || nullif(btrim(m.subtitle), '') || ')', '') || ', ' || to_char(m.meeting_date, 'DD/MM/YYYY')
              || case when p.urgent then ' · Urgent' else '' end;
  v_link := case when m.job_id is not null then '/jobs/' || m.job_id || '/minutes/' || m.id
                 when m.enquiry_id is not null then '/estimating/e/' || m.enquiry_id || '/minutes/' || m.id
                 else '/my-tasks' end;

  update notifications set status = 'done'
   where source_table = 'meeting_points' and source_id = p.id and kind = 'minutes_action' and status <> 'done'
     and profile_id is distinct from p.owner_profile_id;

  select id into existing from notifications
   where source_table = 'meeting_points' and source_id = p.id and kind = 'minutes_action' and profile_id = p.owner_profile_id and status <> 'done'
   limit 1;
  if existing is not null then
    update notifications set title = v_title, detail = v_detail, due_date = p.due_date, link = v_link, job_id = m.job_id where id = existing;
  else
    if p.carried_from ? 'pointId' and (p.carried_from->>'pointId') ~ '^[0-9a-fA-F-]{36}$' then
      select n.emailed_at into carried_emailed from notifications n
       where n.source_table = 'meeting_points' and n.source_id = (p.carried_from->>'pointId')::uuid and n.profile_id = p.owner_profile_id
       order by n.created_at desc limit 1;
    end if;
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id, emailed_at)
    values (p.owner_profile_id, m.job_id, 'minutes_action', v_title, v_detail, p.due_date, v_link, 'meeting_points', p.id, carried_emailed);
  end if;
end $$;
revoke execute on function public.refresh_minutes_action(meeting_points) from public, anon, authenticated;

-- a meeting moved (estimate → job when won), renamed or re-dated: attendees and points follow; reminders say so
create or replace function public.meeting_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p meeting_points;
begin
  if new.job_id is distinct from old.job_id then
    update meeting_attendees set job_id = new.job_id where meeting_id = new.id;
    update meeting_points set job_id = new.job_id where meeting_id = new.id;
  end if;
  if (new.project, new.subtitle, new.meeting_date, new.job_id, new.enquiry_id) is distinct from (old.project, old.subtitle, old.meeting_date, old.job_id, old.enquiry_id) then
    for p in select * from meeting_points where meeting_id = new.id and is_action and not done and not carried_forward and owner_profile_id is not null loop
      perform public.refresh_minutes_action(p);
    end loop;
  end if;
  return new;
end $$;

-- an enquiry won and set up as a job (the job is put on the enquiry): its meetings become the job's
create or replace function public.enquiry_meetings_to_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
begin
  if new.job_id is null or new.job_id is not distinct from old.job_id then return new; end if;
  select * into j from jobs where id = new.job_id;
  update meetings set job_id = new.job_id, enquiry_id = null, project = j.job_no || ' ' || j.code || ' · ' || j.name
   where enquiry_id = new.id;
  return new;
end $$;
drop trigger if exists enquiry_meetings_to_job on enquiries;
create trigger enquiry_meetings_to_job after update of job_id on enquiries for each row execute function public.enquiry_meetings_to_job();

-- My tasks: my open actions across all jobs and estimates
drop function if exists public.my_minutes_actions();
create function public.my_minutes_actions()
returns table (
  point_id uuid, meeting_id uuid, job_id uuid, enquiry_id uuid, text text, due_date date, urgent boolean, updates jsonb,
  project text, subtitle text, meeting_date date, job_no integer, job_code text, job_name text, job_status text,
  enquiry_no integer, enquiry_name text, attendees jsonb
)
language sql stable security definer set search_path = public as $$
  select p.id, m.id, m.job_id, m.enquiry_id, p.text, p.due_date, p.urgent, p.updates,
         m.project, m.subtitle, m.meeting_date, j.job_no::integer, j.code::text, j.name::text, j.status::text,
         e.enquiry_no::integer, e.name::text,
         coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'initials', a.initials) order by a.sort)
                   from meeting_attendees a where a.meeting_id = m.id), '[]'::jsonb)
  from meeting_points p
  join meetings m on m.id = p.meeting_id
  left join jobs j on j.id = m.job_id
  left join enquiries e on e.id = m.enquiry_id
  where p.owner_profile_id = auth.uid() and p.type = 'note' and p.is_action and not p.done and not p.carried_forward
$$;
grant execute on function public.my_minutes_actions() to authenticated;

-- tick an action: its owner, or anyone who can open that job's or estimate's minutes; not on an archived job
create or replace function public.complete_minutes_action(point uuid, is_done boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  p meeting_points;
  m meetings;
begin
  select * into p from meeting_points where id = point;
  if p.id is null then raise exception 'That action has been deleted.'; end if;
  select * into m from meetings where id = p.meeting_id;
  if not (coalesce(p.owner_profile_id = auth.uid(), false)
          or (case when m.enquiry_id is not null then public.has_access('estimating') else public.has_access('job_minutes') end)) then
    raise exception 'Only the action''s owner, or someone who can open these minutes, can tick it.';
  end if;
  if m.job_id is not null and public.job_archived(m.job_id) then
    raise exception 'This job is archived (read-only). An admin can unarchive it to make changes.';
  end if;
  update meeting_points set done = is_done, is_action = not is_done where id = point;
end $$;
grant execute on function public.complete_minutes_action(uuid, boolean) to authenticated;
