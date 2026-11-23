-- =====================================================================
-- 043 · The access grid enforced by the database (22 Nov)
-- Until now Settings › Access only hid screens (requisitions apart). Now the
-- database itself only lets someone read or change a part of the app their
-- profile type is ticked for, which must be in place before External logins.
-- - has_access(part) (script 035) decides: admins everything; someone with
--   no type yet everything but the buyer's lists (nobody is locked out)
-- - each table follows its part of the app (below). Quotations and
--   programmes follow the job's part, or Estimating for an enquiry's
-- - a part you can't open just comes back empty: pages don't break
-- - left open to all signed-in staff, as several parts use them: contractors
--   and their contacts / insurances, O&M standard documents, wording and
--   clauses, company settings, profiles, reminders
-- - the requisition forms' site list comes from requisition_sites(): just
--   each live / tender job's number, code and name, for anyone who can raise
--   requisitions
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

do $$
declare
  m record;
begin
  for m in
    select * from (values
      -- jobs: the job itself and what sits on its Overview
      ('jobs', 'jobs'), ('job_directory', 'jobs'), ('job_team', 'jobs'), ('progress_reports', 'jobs'),
      ('sow_revisions', 'jobs'), ('sow_lines', 'jobs'), ('om_requirements', 'jobs'),
      -- job › commercial
      ('variations', 'job_commercial'), ('variation_lines', 'job_commercial'),
      ('applications', 'job_commercial'), ('application_lines', 'job_commercial'),
      ('orders', 'job_commercial'), ('payment_notices', 'job_commercial'), ('payment_notice_adjustments', 'job_commercial'),
      ('sub_applications', 'job_commercial'), ('sub_application_lines', 'job_commercial'), ('sub_variations', 'job_commercial'),
      ('packages', 'job_commercial'), ('cashflow_issues', 'job_commercial'), ('cashflow_items', 'job_commercial'),
      ('cashflow_line_trades', 'job_commercial'), ('cashflow_stages', 'job_commercial'), ('cashflow_weights', 'job_commercial'),
      ('cost_imports', 'job_commercial'), ('cost_lines', 'job_commercial'),
      ('cvrs', 'job_commercial'), ('cvr_budget_lines', 'job_commercial'), ('cvr_package_forecasts', 'job_commercial'), ('cvr_vo_allocations', 'job_commercial'),
      -- job › procurement, sampling, EOT
      ('procurement_items', 'job_procurement'), ('procurement_splits', 'job_procurement'), ('supplier_packages', 'job_procurement'),
      ('samples', 'job_sampling'), ('finish_schedules', 'job_sampling'),
      ('eot_claims', 'job_eot'), ('eot_claim_events', 'job_eot'), ('delay_events', 'job_eot'),
      -- estimating
      ('enquiries', 'estimating')
    ) as v(tbl, part)
  loop
    if to_regclass('public.' || m.tbl) is null then continue; end if;
    execute format('drop policy if exists "access grid" on public.%I', m.tbl);
    execute format('create policy "access grid" on public.%I as restrictive for all to authenticated using (public.has_access(%L)) with check (public.has_access(%L))', m.tbl, m.part, m.part);
  end loop;
end $$;

-- quotations and programmes: a job's follow that job part; an enquiry's follow Estimating
drop policy if exists "access grid" on quotations;
create policy "access grid" on quotations as restrictive for all to authenticated
  using (case when job_id is not null then public.has_access('job_commercial') else public.has_access('estimating') end)
  with check (case when job_id is not null then public.has_access('job_commercial') else public.has_access('estimating') end);
do $$
declare t text;
begin
  foreach t in array array['quotation_lines', 'quotation_clauses'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "access grid" on public.%I', t);
    execute format('create policy "access grid" on public.%I as restrictive for all to authenticated using (public.has_access(''job_commercial'') or public.has_access(''estimating'')) with check (public.has_access(''job_commercial'') or public.has_access(''estimating''))', t);
  end loop;
end $$;

drop policy if exists "access grid" on programmes;
create policy "access grid" on programmes as restrictive for all to authenticated
  using (case when job_id is not null then public.has_access('job_programme') else public.has_access('estimating') end)
  with check (case when job_id is not null then public.has_access('job_programme') else public.has_access('estimating') end);
do $$
declare t text;
begin
  foreach t in array array['programme_revisions', 'programme_tasks'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "access grid" on public.%I', t);
    execute format('create policy "access grid" on public.%I as restrictive for all to authenticated using (public.has_access(''job_programme'') or public.has_access(''estimating'')) with check (public.has_access(''job_programme'') or public.has_access(''estimating''))', t);
  end loop;
end $$;

-- the requisition forms' site list: number, code and name only, for anyone who can raise requisitions
create or replace function public.requisition_sites() returns table (id uuid, job_no integer, code text, name text, status text)
language sql stable security definer set search_path = public as $$
  select j.id, j.job_no::integer, j.code::text, j.name::text, j.status::text
  from jobs j
  where j.status::text in ('live', 'tender') and (public.has_access('site') or public.has_access('jobs'))
  order by j.job_no desc
$$;
grant execute on function public.requisition_sites() to authenticated;
