-- =====================================================================
-- 082 · Accident and incident reports (24 Nov)
-- Job › H&S › Accidents: a standard report for an accident, near miss, dangerous occurrence, ill-health or damage on a job: who, what
-- happened, injury and treatment, causes, RIDDOR, and the actions to stop it happening again (with an owner, a date and a close-out).
-- Numbered A001, A002... on each job (never reused). Access follows Job › H&S; an archived job is read-only; photos use storage "hs".
-- Contains personal details: only people with Job › H&S access can see them. Run after 081. Safe to run more than once.
-- =====================================================================
alter table jobs add column if not exists accident_counter int not null default 0;

create table if not exists accident_reports (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  number          int not null default 0,                 -- 1, 2, 3 on each job: set by the database
  incident_on     date not null,
  incident_time   text,                                   -- e.g. 14:30
  location        text,
  kind            text not null default 'accident' check (kind in ('accident', 'near_miss', 'dangerous_occurrence', 'ill_health', 'damage', 'environmental')),
  -- the person
  person_name     text,
  person_type     text check (person_type in ('employee', 'subcontractor', 'visitor', 'public')),
  person_company  text,
  person_role     text,                                   -- trade / occupation
  person_phone    text,
  -- the injury
  severity        text not null default 'none' check (severity in ('none', 'first_aid', 'medical', 'lost_time', 'major', 'fatal')),
  injury          text,                                   -- nature of the injury and the part of the body
  treatment       text,                                   -- first aid / treatment given, by whom
  hospital        boolean not null default false,
  days_lost       int,
  -- what happened
  description     text,
  witnesses       text,
  immediate_cause text,
  root_cause      text,
  immediate_action text,
  -- RIDDOR
  riddor          text not null default 'no' check (riddor in ('no', 'check', 'yes')),
  riddor_ref      text,
  riddor_on       date,
  -- stopping it happening again
  corrective      text,
  corrective_owner text,
  corrective_due  date,
  corrective_closed_on date,
  reported_by     text,
  investigated_by text,
  status          text not null default 'open' check (status in ('open', 'closed')),
  created_by      uuid references profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (job_id, number)
);
create index if not exists accident_reports_job on accident_reports (job_id, incident_on desc);

create or replace function public.accident_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update jobs set accident_counter = accident_counter + 1 where id = new.job_id returning accident_counter into n;
  new.number := n;
  return new;
end $$;
drop trigger if exists accident_number on accident_reports;
create trigger accident_number before insert on accident_reports for each row execute function public.accident_number();
create or replace function public.accident_guard() returns trigger language plpgsql as $$
begin
  if new.number is distinct from old.number then raise exception 'A report''s number cannot be changed.'; end if;
  if new.job_id is distinct from old.job_id then raise exception 'A report cannot move to another job.'; end if;
  return new;
end $$;
drop trigger if exists accident_guard on accident_reports;
create trigger accident_guard before update on accident_reports for each row execute function public.accident_guard();
drop trigger if exists t_accident_reports_upd on accident_reports;
create trigger t_accident_reports_upd before update on accident_reports for each row execute function set_updated_at();

alter table accident_reports enable row level security;
grant select, insert, update, delete on accident_reports to authenticated;
drop policy if exists "signed-in users" on accident_reports;
create policy "signed-in users" on accident_reports for all to authenticated using (true) with check (true);
drop policy if exists "access grid" on accident_reports;
create policy "access grid" on accident_reports as restrictive for all to authenticated using (public.has_access('job_hs')) with check (public.has_access('job_hs'));
drop policy if exists "archived job: no changes" on accident_reports;
create policy "archived job: no changes" on accident_reports as restrictive for all to authenticated using (true) with check (not public.job_archived(job_id));
-- a report is a legal record: only an admin can delete one
drop policy if exists "admins delete accident reports" on accident_reports;
create policy "admins delete accident reports" on accident_reports as restrictive for delete to authenticated using (public.is_admin());

-- photos can be added to a report
alter table hs_files drop constraint if exists hs_files_record_kind_check;
alter table hs_files add constraint hs_files_record_kind_check check (record_kind in ('diary', 'delivery', 'inspection', 'accident'));
