-- =====================================================================
-- 034 · Operations user type; requisitions locked down (22 Nov)
-- Richard: "I want this entire screen [the buyer's lists] to only show to
-- people with operations tagged logins and admin".
-- - profiles.is_operations: an Operations login. Admins tick it in the app
--   (Settings › Users); is_admin still only changes here in the SQL Editor
-- - is_operations(): true for Operations logins and admins
-- - requisitions, their messages and attachments: Operations / admins see
--   them all; anyone else sees only the ones they raised (and can only add
--   to those). Only Operations / admins delete them
-- No existing data is lost.
-- =====================================================================

alter table profiles add column if not exists is_operations boolean not null default false;

create or replace function public.is_operations() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin or is_operations from profiles where id = auth.uid()), false)
$$;
grant execute on function public.is_operations() to authenticated;

-- admins tag someone as Operations (or untag them) from Settings › Users
create or replace function public.set_operations(person uuid, on_off boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change who is Operations.'; end if;
  update profiles set is_operations = on_off where id = person;
end $$;
grant execute on function public.set_operations(uuid, boolean) to authenticated;

-- requisitions: Operations / admins all; everyone else their own
drop policy if exists "signed-in users" on requisitions;
drop policy if exists "requisitions: read" on requisitions;
drop policy if exists "requisitions: raise" on requisitions;
drop policy if exists "requisitions: change" on requisitions;
drop policy if exists "requisitions: delete" on requisitions;
create policy "requisitions: read" on requisitions for select to authenticated using (requested_by = auth.uid() or public.is_operations());
create policy "requisitions: raise" on requisitions for insert to authenticated with check (requested_by = auth.uid() or public.is_operations());
create policy "requisitions: change" on requisitions for update to authenticated using (requested_by = auth.uid() or public.is_operations()) with check (requested_by = auth.uid() or public.is_operations());
create policy "requisitions: delete" on requisitions for delete to authenticated using (public.is_operations());

-- messages and attachments follow the requisition they're on
drop policy if exists "signed-in users" on requisition_messages;
drop policy if exists "requisition messages: read" on requisition_messages;
drop policy if exists "requisition messages: add" on requisition_messages;
drop policy if exists "requisition messages: delete" on requisition_messages;
create policy "requisition messages: read" on requisition_messages for select to authenticated
  using (exists (select 1 from requisitions r where r.id = requisition_id));
create policy "requisition messages: add" on requisition_messages for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from requisitions r where r.id = requisition_id));
create policy "requisition messages: delete" on requisition_messages for delete to authenticated using (public.is_operations());

drop policy if exists "signed-in users" on requisition_files;
drop policy if exists "requisition files: read" on requisition_files;
drop policy if exists "requisition files: add" on requisition_files;
drop policy if exists "requisition files: remove" on requisition_files;
create policy "requisition files: read" on requisition_files for select to authenticated
  using (exists (select 1 from requisitions r where r.id = requisition_id));
create policy "requisition files: add" on requisition_files for insert to authenticated
  with check (exists (select 1 from requisitions r where r.id = requisition_id));
create policy "requisition files: remove" on requisition_files for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_operations());

-- the stored files themselves: only for someone who can see the requisition (the path starts job/requisition/)
drop policy if exists "requisitions: signed-in read" on storage.objects;
drop policy if exists "requisitions: signed-in add" on storage.objects;
drop policy if exists "requisitions: signed-in remove" on storage.objects;
drop policy if exists "requisitions: read" on storage.objects;
drop policy if exists "requisitions: add" on storage.objects;
drop policy if exists "requisitions: remove" on storage.objects;
create policy "requisitions: read" on storage.objects for select to authenticated
  using (bucket_id = 'requisitions' and exists (select 1 from public.requisitions r where r.id::text = (storage.foldername(name))[2]));
create policy "requisitions: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'requisitions' and exists (select 1 from public.requisitions r where r.id::text = (storage.foldername(name))[2]));
create policy "requisitions: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'requisitions' and exists (select 1 from public.requisitions r where r.id::text = (storage.foldername(name))[2]));

-- who's who: tick yourself / others here too if easier
-- update profiles set is_operations = true where lower(email) = 'name@duboulay.co.uk';
select email, is_admin, is_operations from profiles order by email;
