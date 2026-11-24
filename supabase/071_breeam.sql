-- =====================================================================
-- 071 · BREEAM tracker (24 Nov)
-- Richard: a tick box when a job is set up says it is a BREEAM job; a BREEAM tab then holds the tracker, worked like the sampling
-- tracker with a dropdown for each line: Not complete / In progress / Completed / By others / No action required.
-- The lines (issues and credits, e.g. "Man 03 Responsible construction practices") are imported from the Excel tracker the
-- client or assessor sends, or added by hand. Access follows "Job › Sampling" (the design side), and an archived job is read-only.
-- Safe to run more than once. No existing data is touched (run after 070).
-- =====================================================================
alter table jobs add column if not exists breeam boolean not null default false;

create table if not exists breeam_items (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  ref               text,                               -- e.g. Man 03
  category          text,                               -- e.g. Management
  title             text not null,                      -- the issue / credit
  credits_available numeric(5,2),
  credits_targeted  numeric(5,2),
  responsible       text,                               -- who delivers it: a subcontractor, the design team, the assessor...
  status            text not null default 'not_complete'
                    check (status in ('not_complete', 'in_progress', 'completed', 'by_others', 'no_action')),
  due_date          date,
  evidence_link     text,
  comments          text,
  sort              int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists breeam_items_job on breeam_items (job_id, sort);

alter table breeam_items enable row level security;
grant select, insert, update, delete on breeam_items to authenticated;
drop policy if exists "signed-in users" on breeam_items;
create policy "signed-in users" on breeam_items for all to authenticated using (true) with check (true);
drop policy if exists "access grid" on breeam_items;
create policy "access grid" on breeam_items as restrictive for all to authenticated using (public.has_access('job_sampling')) with check (public.has_access('job_sampling'));
drop policy if exists "archived job: no changes" on breeam_items;
create policy "archived job: no changes" on breeam_items as restrictive for all to authenticated using (true) with check (not public.job_archived(job_id));
grant select, insert, update, delete on breeam_items to service_role;
