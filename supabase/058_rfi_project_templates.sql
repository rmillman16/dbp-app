-- =====================================================================
-- 058 · RFI templates per project (23 Nov)
-- Richard: templates are project specific; a joinery RFI goes to one set of people on one job and another on the next.
-- - a template can belong to one job (job_id), with its people named outright (assignee_keys / cc_keys, "d:<directory id>"
--   or "p:<profile id>") and its manager. The standard templates (no job) stay as starting points that fill people by role
--   and that each job copies and edits
-- - anyone with "Job › RFIs & submittals" access can add and change their job's templates (not on an archived job);
--   only admins change the standard ones
-- Safe to run more than once. No existing data is lost (run after 057).
-- =====================================================================
alter table rfi_templates add column if not exists job_id        uuid references jobs(id) on delete cascade;
alter table rfi_templates add column if not exists assignee_keys text[] not null default '{}';
alter table rfi_templates add column if not exists cc_keys       text[] not null default '{}';
alter table rfi_templates add column if not exists manager_id    uuid references profiles(id) on delete set null;
create index if not exists rfi_templates_job on rfi_templates (job_id);

drop policy if exists "templates: change" on rfi_templates;
drop policy if exists "templates: standard" on rfi_templates;
drop policy if exists "templates: project" on rfi_templates;
create policy "templates: standard" on rfi_templates for all to authenticated
  using (job_id is null and public.is_admin()) with check (job_id is null and public.is_admin());
create policy "templates: project" on rfi_templates for all to authenticated
  using (job_id is not null and public.has_access('job_rfis'))
  with check (job_id is not null and public.has_access('job_rfis') and not public.job_archived(job_id));
