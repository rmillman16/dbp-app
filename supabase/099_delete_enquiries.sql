-- =====================================================================
-- 099 · Delete an estimating enquiry made in error (26 Nov)
-- Only admins can delete an enquiry, and not one that was won (it is a job by then: archive or delete the job instead).
-- Its programme, minutes, RFIs, tender packages and directory go with it; its quotations are deleted too.
-- Run after 098. Safe to run again.
-- =====================================================================
create or replace function public.enquiry_delete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can delete an enquiry.'; end if;
  if old.job_id is not null then raise exception 'This enquiry was won and is now a job, so it cannot be deleted.'; end if;
  delete from quotations where enquiry_id = old.id and job_id is null;
  return old;
end $$;
drop trigger if exists enquiry_delete_guard on enquiries;
create trigger enquiry_delete_guard before delete on enquiries for each row execute function public.enquiry_delete_guard();

grant delete on enquiries to authenticated;
drop policy if exists "admins delete enquiries" on enquiries;
create policy "admins delete enquiries" on enquiries for delete to authenticated using (public.is_admin());
notify pgrst, 'reload schema';
