-- =====================================================================
-- 094 · Delete a job made in error (26 Nov)
-- Only admins can delete a job. Everything filed under it (programme, minutes, orders, RFIs, etc.) goes with it, so the app
-- asks for the job number to be typed first. An estimate that was set up as the job is kept and simply unlinked.
-- Run after 093. Safe to run again.
-- =====================================================================
create or replace function public.job_delete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can delete a job.'; end if;
  return old;
end $$;
drop trigger if exists job_delete_guard on jobs;
create trigger job_delete_guard before delete on jobs for each row execute function public.job_delete_guard();

grant delete on jobs to authenticated;
drop policy if exists "admins delete jobs" on jobs;
create policy "admins delete jobs" on jobs for delete to authenticated using (public.is_admin());
