-- =====================================================================
-- 103 · PQQ reminders go to the Accounts team only (27 Nov)
-- Every PQQ reminder (chase, review, expiring PQQ, expiring documents) now goes to everyone whose profile type is Accounts,
-- and to nobody else (no longer the named chaser or the admins). Run after 102. Safe to run again.
-- =====================================================================
create or replace function public.pqq_chasers(p_company uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where 'accounts' = any (roles)
$$;

-- rebuild every company's reminders now: those for the old recipients close, and Accounts get theirs
do $$
declare c uuid;
begin
  for c in select id from companies loop
    perform public.refresh_pqq_reminders(c);
  end loop;
end $$;

notify pgrst, 'reload schema';
