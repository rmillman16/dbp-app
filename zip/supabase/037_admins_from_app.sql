-- =====================================================================
-- 037 · Admins can make other people admins from the app (22 Nov)
-- Richard: "why can't I make him admin or IT?" Until now admin was only set
-- here in the SQL Editor. Now admins (IT included) can tick Admin against a
-- person in Settings › Users, with two safeguards:
-- - you can't take admin off yourself (no locking yourself out)
-- - the last admin can't be taken off
-- Taking admin off someone also takes off IT (IT is an admin login).
-- No existing data is lost.
-- =====================================================================

create or replace function public.set_admin(person uuid, on_off boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change who is an admin.'; end if;
  if not on_off then
    if person = auth.uid() then raise exception 'You can''t take admin off yourself: ask another admin.'; end if;
    if (select count(*) from profiles where is_admin and id <> person) = 0 then raise exception 'There must always be at least one admin.'; end if;
  end if;
  update profiles set is_admin = on_off, is_it = case when on_off then is_it else false end where id = person;
end $$;
grant execute on function public.set_admin(uuid, boolean) to authenticated;
