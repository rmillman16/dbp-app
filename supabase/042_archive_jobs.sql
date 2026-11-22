-- =====================================================================
-- 042 · Archiving jobs: admins only (22 Nov)
-- Agreed: a finished job becomes read-only and leaves the live lists; its
-- defects and retention reminders keep running on the bell. Richard: "add
-- in archiving jobs ability for admins only".
-- - only admins can archive a job or bring it back (status 'archived')
-- - an archived job's own details can't be changed by anyone until an admin
--   unarchives it
-- - everything filed under an archived job (anything with a job_id: VOs,
--   applications, payment notices, programme, procurement, samples, CVR…)
--   can be read but not added to, changed or deleted. Reminders are
--   untouched, so they keep running and can still be marked done / snoozed
-- No existing data is lost.
-- =====================================================================

create or replace function public.job_archived(job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'archived' from jobs where id = job), false)
$$;
grant execute on function public.job_archived(uuid) to authenticated;

-- the job itself: archiving / unarchiving is for admins; an archived job is frozen
create or replace function public.job_archive_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status = 'archived') is distinct from (old.status = 'archived') then
    if not public.is_admin() then raise exception 'Only admins can archive or unarchive a job.'; end if;
  elsif old.status = 'archived' then
    raise exception 'This job is archived (read-only). An admin can unarchive it to make changes.';
  end if;
  return new;
end $$;
drop trigger if exists job_archive_guard on jobs;
create trigger job_archive_guard before update on jobs for each row execute function public.job_archive_guard();

create or replace function public.job_insert_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'archived' and not public.is_admin() then raise exception 'Only admins can archive a job.'; end if;
  return new;
end $$;
drop trigger if exists job_insert_guard on jobs;
create trigger job_insert_guard before insert on jobs for each row execute function public.job_insert_guard();

-- everything filed under a job: read-only while it's archived (extra rules on top of the existing ones)
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'job_id' and c.table_name not in ('notifications', 'jobs')
  loop
    execute format('drop policy if exists "archived job: no adding" on public.%I', t);
    execute format('drop policy if exists "archived job: no changes" on public.%I', t);
    execute format('drop policy if exists "archived job: no deleting" on public.%I', t);
    execute format('create policy "archived job: no adding" on public.%I as restrictive for insert to authenticated with check (job_id is null or not public.job_archived(job_id))', t);
    execute format('create policy "archived job: no changes" on public.%I as restrictive for update to authenticated using (job_id is null or not public.job_archived(job_id)) with check (job_id is null or not public.job_archived(job_id))', t);
    execute format('create policy "archived job: no deleting" on public.%I as restrictive for delete to authenticated using (job_id is null or not public.job_archived(job_id))', t);
  end loop;
end $$;

-- which tables got the rule (for the record)
select c.table_name from information_schema.columns c
join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
where c.table_schema = 'public' and c.column_name = 'job_id' and c.table_name not in ('notifications', 'jobs')
order by 1;
