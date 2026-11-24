-- =====================================================================
-- 076 · Project checklist (24 Nov)
-- A checklist on each job's Overview for health & safety and compliance (has the F10 been done, construction phase plan, principal
-- designer / contractor, building control, insurances and so on). The app adds the standard items the first time a job's checklist is
-- opened; people can tick, mark not applicable, date and note each one, and add their own. Access follows the Jobs section;
-- an archived job is read-only. Safe to run more than once.
-- =====================================================================
create table if not exists job_checklist (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references jobs(id) on delete cascade,
  key        text not null,                          -- standard items: f10, cpp ...; own items: custom-<n>
  category   text not null default 'Health and safety',
  title      text not null,
  done       boolean not null default false,
  na         boolean not null default false,         -- not applicable on this job
  done_on    date,
  note       text,
  sort       int not null default 0,
  custom     boolean not null default false,
  updated_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (job_id, key)
);
create index if not exists job_checklist_job on job_checklist (job_id);

alter table job_checklist enable row level security;
grant select, insert, update, delete on job_checklist to authenticated;
drop policy if exists "signed-in users" on job_checklist;
create policy "signed-in users" on job_checklist for all to authenticated using (true) with check (true);
drop policy if exists "access grid" on job_checklist;
create policy "access grid" on job_checklist as restrictive for all to authenticated using (public.has_access('jobs')) with check (public.has_access('jobs'));
drop policy if exists "archived job: no changes" on job_checklist;
create policy "archived job: no changes" on job_checklist as restrictive for all to authenticated using (true) with check (not public.job_archived(job_id));
grant select, insert, update, delete on job_checklist to service_role;
