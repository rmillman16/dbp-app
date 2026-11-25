-- =====================================================================
-- 085 · Minutes upgrade (24 Nov)
-- Run after 084. Safe to run more than once.
-- 1 Chasing: an action with an owner and a due date is chased. A staff owner gets a fresh bell message (and email) 2 days before it is
--   due and again every 7 days while it is overdue; an outside owner (an attendee typed in with an email address) is queued an email
--   in action_outbox, sent by the send-emails function with their private link. Ticking it done (anywhere) stops the chasing.
-- 3 Meeting types: meetings.meeting_type ("progress", "design"...), which loads that type's standing headings. Attendees can be
--   "apologies" (attendees.apology).
-- 5 Numbering: meetings.meeting_no (Meeting 12, counted per job / estimate; older meetings are numbered by date). Item numbers (4.3)
--   are worked out from the headings and need nothing stored.
-- 6 Links: meeting_points.refs (RFIs, submittals, snags and variations a point is about).
-- 7 Issuing: issue_minutes() records who issued which revision to whom, keeps a copy of exactly what was issued (meeting_issues) and
--   locks the minutes; amend_minutes() unlocks them for the next revision.
-- 8 Outside owners' actions: action_links (their private link, /a/<token>), action_outbox, meeting_points.done_by (who ticked it
--   done on the hub). The "external" function lists and ticks them; it needs no other database change.
-- =====================================================================

-- ---------- meetings ----------
alter table meetings add column if not exists meeting_no int;
alter table meetings add column if not exists meeting_type text;
alter table meetings add column if not exists issued_rev int not null default 0;
alter table meetings add column if not exists locked boolean not null default false;

-- older meetings: numbered by when they were made, per job / estimate
with n as (
  select id, row_number() over (partition by coalesce(job_id, enquiry_id) order by created_at, id) as rn from meetings where meeting_no is null and (job_id is not null or enquiry_id is not null)   -- a meeting with neither can't be updated (check constraint meetings_job_or_enquiry)
)
update meetings m set meeting_no = n.rn from n where n.id = m.id;

create or replace function public.meeting_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.meeting_no is null then
    select coalesce(max(meeting_no), 0) + 1 into new.meeting_no from meetings
     where job_id is not distinct from new.job_id and enquiry_id is not distinct from new.enquiry_id;
  end if;
  return new;
end $$;
drop trigger if exists meeting_number on meetings;
create trigger meeting_number before insert on meetings for each row execute function public.meeting_number();

alter table meeting_attendees add column if not exists apology boolean not null default false;

alter table meeting_points add column if not exists refs jsonb not null default '[]'::jsonb;   -- [{kind, id, label}]
alter table meeting_points add column if not exists done_by text;                              -- who ticked it done on the hub
alter table meeting_points add column if not exists last_chased_on date;
alter table meeting_points add column if not exists due_reminded boolean not null default false;

-- a new due date starts the reminders afresh
create or replace function public.meeting_point_due_reset() returns trigger
language plpgsql as $$
begin
  if new.due_date is distinct from old.due_date then
    new.due_reminded := false;
    new.last_chased_on := null;
  end if;
  return new;
end $$;
drop trigger if exists meeting_point_due_reset on meeting_points;
create trigger meeting_point_due_reset before update on meeting_points for each row execute function public.meeting_point_due_reset();

-- ---------- what was issued ----------
create table if not exists meeting_issues (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references meetings(id) on delete cascade,
  job_id         uuid references jobs(id) on delete cascade,
  rev            int not null,
  issued_at      timestamptz not null default now(),
  issued_by      uuid references profiles(id) on delete set null default auth.uid(),
  issued_by_name text,
  sent_to        jsonb not null default '[]'::jsonb,       -- [{name, email}]
  note           text,
  snapshot       jsonb not null                            -- the minutes exactly as issued
);
create unique index if not exists meeting_issues_rev on meeting_issues (meeting_id, rev);
alter table meeting_issues enable row level security;
grant select on meeting_issues to authenticated;
drop policy if exists "signed-in users" on meeting_issues;
create policy "signed-in users" on meeting_issues for select to authenticated using (true);
drop policy if exists "access grid" on meeting_issues;
create policy "access grid" on meeting_issues as restrictive for select to authenticated using (exists (select 1 from meetings m where m.id = meeting_id));
grant select, insert, update, delete on meeting_issues to service_role;

-- issue the minutes: records the revision, keeps what was issued and locks the meeting; the outside people who own an open
-- action are queued an email with their link. p_snapshot is the minutes as the app shows them.
create or replace function public.issue_minutes(p_meeting uuid, p_snapshot jsonb, p_to jsonb default '[]'::jsonb, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  m meetings;
  v_rev int;
  v_name text;
begin
  select * into m from meetings where id = p_meeting;
  if m.id is null then raise exception 'That meeting has been deleted.'; end if;
  if not (case when m.enquiry_id is not null then public.has_access('estimating') else public.has_access('job_minutes') end) then
    raise exception 'You cannot issue these minutes.';
  end if;
  if m.job_id is not null and public.job_archived(m.job_id) then
    raise exception 'This job is archived (read-only). An admin can unarchive it to make changes.';
  end if;
  v_rev := m.issued_rev + 1;
  select full_name into v_name from profiles where id = auth.uid();
  insert into meeting_issues (meeting_id, job_id, rev, issued_by_name, sent_to, note, snapshot)
  values (m.id, m.job_id, v_rev, coalesce(v_name, ''), coalesce(p_to, '[]'::jsonb), nullif(btrim(coalesce(p_note, '')), ''), p_snapshot);
  update meetings set issued_rev = v_rev, locked = true where id = m.id;
  insert into action_outbox (point_id, email, kind)
  select p.id, lower(btrim(a.email)), 'new'
    from meeting_points p join meeting_attendees a on a.id = p.owner_attendee_id
   where p.meeting_id = m.id and p.type = 'note' and p.is_action and not p.done and not p.carried_forward
     and a.profile_id is null and a.email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  return v_rev;
end $$;
grant execute on function public.issue_minutes(uuid, jsonb, jsonb, text) to authenticated;

create or replace function public.amend_minutes(p_meeting uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m meetings;
begin
  select * into m from meetings where id = p_meeting;
  if m.id is null then raise exception 'That meeting has been deleted.'; end if;
  if not (case when m.enquiry_id is not null then public.has_access('estimating') else public.has_access('job_minutes') end) then
    raise exception 'You cannot change these minutes.';
  end if;
  if m.job_id is not null and public.job_archived(m.job_id) then
    raise exception 'This job is archived (read-only). An admin can unarchive it to make changes.';
  end if;
  update meetings set locked = false where id = m.id;
end $$;
grant execute on function public.amend_minutes(uuid) to authenticated;

-- ---------- outside owners ----------
-- the emails waiting to go to outside people about their actions (sent by send-emails, which groups them per person and job)
create table if not exists action_outbox (
  id         uuid primary key default gen_random_uuid(),
  point_id   uuid not null references meeting_points(id) on delete cascade,
  email      text not null,
  kind       text not null check (kind in ('new', 'due', 'overdue')),
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists action_outbox_waiting on action_outbox (created_at) where sent_at is null;
alter table action_outbox enable row level security;            -- no policy: only the server reads it
grant select, insert, update, delete on action_outbox to service_role;

-- their private link (only its hash is kept; made by send-emails, valid 90 days): opens that person's actions, no login
create table if not exists action_links (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '90 days'),
  revoked_at   timestamptz,
  last_used_at timestamptz,
  use_count    int not null default 0
);
alter table action_links enable row level security;             -- no policy: only the server reads it
grant select, insert, update, delete on action_links to service_role;

-- ---------- chasing ----------
-- the action's text as a person reads it: @AK becomes the attendee's name
create or replace function public.minutes_plain(p_text text, p_meeting uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  t text := coalesce(nullif(btrim(p_text), ''), '(no description)');
  a record;
begin
  for a in select initials, name from meeting_attendees where meeting_id = p_meeting order by length(initials) desc loop
    t := regexp_replace(t, '@' || regexp_replace(a.initials, '([^A-Za-z0-9])', '\\\1', 'g') || '(?![A-Za-z0-9])', replace(a.name, '\', '\\'), 'gi');
  end loop;
  return t;
end $$;
revoke execute on function public.minutes_plain(text, uuid) from public, anon, authenticated;

-- Called by the send-emails function every couple of minutes (server key). An open action with a due date and an owner:
--  - from 2 days before it is due: one reminder
--  - once it is overdue: a fresh chase every 7 days
-- a staff owner gets it on the bell (emailed); an outside owner is queued in action_outbox. Returns how many were chased.
create or replace function public.minutes_chase_tick() returns int
language plpgsql security definer set search_path = public as $$
declare
  p meeting_points; m meetings; j jobs; e enquiries; a meeting_attendees;
  k text; n int := 0; t text; v_title text; v_detail text; v_link text; v_kind text;
begin
  for p in
    select * from meeting_points
     where type = 'note' and is_action and not done and not carried_forward and due_date is not null and owner_attendee_id is not null and due_date <= current_date + 2
  loop
    k := null;
    if p.due_date < current_date then
      if p.last_chased_on is null or p.last_chased_on <= current_date - 7 then k := 'overdue'; end if;
    elsif not p.due_reminded then
      k := 'due';
    end if;
    if k is null then continue; end if;
    select * into m from meetings where id = p.meeting_id;
    if m.id is null then continue; end if;
    select * into j from jobs where id = m.job_id;
    if m.job_id is not null and (j.id is null or j.status <> 'live') then continue; end if;
    select * into e from enquiries where id = m.enquiry_id;
    select * into a from meeting_attendees where id = p.owner_attendee_id;
    if a.id is null then continue; end if;

    if a.profile_id is not null then
      t := public.minutes_plain(p.text, m.id);
      v_kind := case when k = 'overdue' then 'minutes_action_overdue' else 'minutes_action_due' end;
      v_title := coalesce(j.job_no || ' ' || j.code || ' ', 'E' || lpad(e.enquiry_no::text, 3, '0') || ' ', '') || case when k = 'overdue' then 'Action OVERDUE: ' else 'Action due: ' end || left(t, 140);
      v_detail := 'From the minutes' || coalesce(' (' || nullif(btrim(m.subtitle), '') || ')', '') || ', ' || to_char(m.meeting_date, 'DD/MM/YYYY') || ' · due ' || to_char(p.due_date, 'DD/MM/YYYY');
      v_link := case when m.job_id is not null then '/jobs/' || m.job_id || '/minutes/' || m.id when m.enquiry_id is not null then '/estimating/e/' || m.enquiry_id || '/minutes/' || m.id else '/tasks' end;
      update notifications set status = 'done', auto_closed = true
       where source_table = 'meeting_points' and source_id = p.id and kind in ('minutes_action_due', 'minutes_action_overdue') and status <> 'done';
      insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (a.profile_id, m.job_id, v_kind, v_title, v_detail, p.due_date, v_link, 'meeting_points', p.id);
    elsif a.email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      insert into action_outbox (point_id, email, kind) values (p.id, lower(btrim(a.email)), k);
    end if;
    update meeting_points set last_chased_on = current_date, due_reminded = true where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.minutes_chase_tick() from public, anon, authenticated;
grant execute on function public.minutes_chase_tick() to service_role;

-- Done on the bell (on a chase message) ticks the action, as it does on the first reminder (045); closing it because the action
-- was done or carried forward doesn't (those are marked auto_closed)
create or replace function public.minutes_chase_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('minutes_action_due', 'minutes_action_overdue') and new.source_table = 'meeting_points' and new.status = 'done' and old.status <> 'done' and not coalesce(new.auto_closed, false) then
    update meeting_points set done = true, is_action = false
     where id = new.source_id and type = 'note' and is_action and not done and not carried_forward
       and owner_profile_id = new.profile_id and (job_id is null or not public.job_archived(job_id));
  end if;
  return new;
end $$;
drop trigger if exists minutes_chase_done on notifications;
create trigger minutes_chase_done after update of status on notifications for each row execute function public.minutes_chase_done();

-- an action done, un-actioned, carried forward or deleted: its chase messages close
create or replace function public.meeting_point_chase_close() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or new.done or not new.is_action or new.carried_forward then
    update notifications set status = 'done', auto_closed = true
     where source_table = 'meeting_points' and source_id = case when tg_op = 'DELETE' then old.id else new.id end
       and kind in ('minutes_action_due', 'minutes_action_overdue') and status <> 'done';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists meeting_point_chase_close on meeting_points;
create trigger meeting_point_chase_close after update or delete on meeting_points for each row execute function public.meeting_point_chase_close();
