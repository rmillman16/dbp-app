-- =====================================================================
-- 035 · Profile types and who sees what (22 Nov)
-- Richard: "I'm going to need project manager, commercial, site management,
-- design, accounts, external, admin and operations profile types which
-- ultimately allow access to different bits".
-- - profiles.roles: a person's profile types (one or more). Admin stays
--   profiles.is_admin, changed only here in the SQL Editor
-- - role_access: which parts of the app each type can open. Everyone can read
--   it; admins change it in Settings › Access (starting ticks below)
-- - has_access(part): admins everything; someone with no type yet keeps
--   today's access (everything but the buyer's lists) so nobody is locked out
--   while types are given out
-- - the requisition buyer's lists follow the grid: material / hire separately
-- - Operations logins from 034 become the Operations type
-- Safe to run more than once (the starting ticks are only added once).
-- No existing data is lost.
-- =====================================================================

alter table profiles add column if not exists roles text[] not null default '{}';
alter table profiles drop constraint if exists profiles_roles_valid;
alter table profiles add constraint profiles_roles_valid
  check (roles <@ array['project_manager', 'commercial', 'site_management', 'design', 'accounts', 'external', 'operations']::text[]);
update profiles set roles = array_append(roles, 'operations') where is_operations and not ('operations' = any(roles));

create table if not exists role_access (
  role     text not null check (role in ('project_manager', 'commercial', 'site_management', 'design', 'accounts', 'external', 'operations')),
  section  text not null,
  primary key (role, section)
);
alter table role_access enable row level security;
drop policy if exists "read access grid" on role_access;
drop policy if exists "admins change access grid" on role_access;
create policy "read access grid" on role_access for select to authenticated using (true);
create policy "admins change access grid" on role_access for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on role_access to authenticated;

-- starting ticks (only if the grid is empty; change them in Settings › Access)
do $$ begin
  if not exists (select 1 from role_access) then
    insert into role_access (role, section) values
      ('project_manager', 'jobs'), ('project_manager', 'job_programme'), ('project_manager', 'job_commercial'), ('project_manager', 'job_procurement'),
      ('project_manager', 'job_sampling'), ('project_manager', 'job_eot'), ('project_manager', 'estimating'), ('project_manager', 'contracts'),
      ('project_manager', 'site'), ('project_manager', 'contractors'),
      ('commercial', 'jobs'), ('commercial', 'job_programme'), ('commercial', 'job_commercial'), ('commercial', 'job_procurement'),
      ('commercial', 'job_sampling'), ('commercial', 'job_eot'), ('commercial', 'estimating'), ('commercial', 'contracts'),
      ('commercial', 'site'), ('commercial', 'contractors'),
      ('site_management', 'jobs'), ('site_management', 'job_programme'), ('site_management', 'job_procurement'), ('site_management', 'job_sampling'),
      ('site_management', 'site'),
      ('design', 'jobs'), ('design', 'job_programme'), ('design', 'job_sampling'), ('design', 'estimating'),
      ('accounts', 'jobs'), ('accounts', 'job_commercial'), ('accounts', 'contractors'), ('accounts', 'site'),
      ('external', 'site'),
      ('operations', 'jobs'), ('operations', 'job_procurement'), ('operations', 'site'), ('operations', 'buyer_material'),
      ('operations', 'buyer_hire'), ('operations', 'contractors');
  end if;
end $$;

create or replace function public.has_access(part text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.is_admin
        or (cardinality(p.roles) = 0 and part not like 'buyer\_%')
        or exists (select 1 from role_access a where a.role = any(p.roles) and a.section = part)
    from profiles p where p.id = auth.uid()), false)
$$;
grant execute on function public.has_access(text) to authenticated;

-- "Operations" in the database now means: can open either buyer's list
create or replace function public.is_operations() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_access('buyer_material') or public.has_access('buyer_hire')
$$;

-- admins give people their profile types (Settings › Users)
create or replace function public.set_roles(person uuid, new_roles text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change profile types.'; end if;
  update profiles set roles = coalesce(new_roles, '{}'), is_operations = ('operations' = any(coalesce(new_roles, '{}'))) where id = person;
end $$;
grant execute on function public.set_roles(uuid, text[]) to authenticated;

-- requisitions: your own, or every one of a kind whose buyer's list you can open
drop policy if exists "requisitions: read" on requisitions;
drop policy if exists "requisitions: change" on requisitions;
create policy "requisitions: read" on requisitions for select to authenticated
  using (requested_by = auth.uid() or public.has_access('buyer_' || kind));
create policy "requisitions: change" on requisitions for update to authenticated
  using (requested_by = auth.uid() or public.has_access('buyer_' || kind))
  with check (requested_by = auth.uid() or public.has_access('buyer_' || kind));

select email, is_admin, roles from profiles order by email;
