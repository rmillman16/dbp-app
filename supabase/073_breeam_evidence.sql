-- =====================================================================
-- 073 · BREEAM evidence (24 Nov)
-- Evidence is attached to a BREEAM line and filed into the job's synced SharePoint folder (EXTERNAL / 08. BREEAM / section / credit).
-- The file itself lives in SharePoint; this table is the record of what was filed against each line (name, folder, who, when) so the
-- tracker shows it. Access follows "Job › Sampling" like the tracker; an archived job is read-only. Safe to run more than once (run after 072).
-- =====================================================================
create table if not exists breeam_evidence (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  item_id     uuid not null references breeam_items(id) on delete cascade,
  file_name   text not null,
  folder      text,                                     -- where it was filed, as shown to people
  filed       boolean not null default false,           -- true = written into the synced folder; false = only noted
  note        text,
  added_by    uuid references auth.users(id) default auth.uid(),
  added_by_name text,
  created_at  timestamptz not null default now()
);
create index if not exists breeam_evidence_item on breeam_evidence (item_id);
create index if not exists breeam_evidence_job on breeam_evidence (job_id);

alter table breeam_evidence enable row level security;
grant select, insert, update, delete on breeam_evidence to authenticated;
drop policy if exists "signed-in users" on breeam_evidence;
create policy "signed-in users" on breeam_evidence for all to authenticated using (true) with check (true);
drop policy if exists "access grid" on breeam_evidence;
create policy "access grid" on breeam_evidence as restrictive for all to authenticated using (public.has_access('job_sampling')) with check (public.has_access('job_sampling'));
drop policy if exists "archived job: no changes" on breeam_evidence;
create policy "archived job: no changes" on breeam_evidence as restrictive for all to authenticated using (true) with check (not public.job_archived(job_id));
grant select, insert, update, delete on breeam_evidence to service_role;
