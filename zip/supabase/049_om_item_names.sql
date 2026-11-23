-- =====================================================================
-- 049 · O&M: your own items in the project items list (23 Nov)
-- Richard: "allow add item into the dropdown menu for project specific
-- items". Anything typed that isn't in the list can be added to it from the
-- dropdown ("+ Add … to the list"); it's then offered on every job. Kept
-- separate from the standard documents by trade (Settings, admins only), so
-- anyone who can open O&M can add to it; admins can remove entries.
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

create table if not exists om_item_names (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  added_by    uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index if not exists om_item_names_name on om_item_names (lower(name));

alter table om_item_names enable row level security;
drop policy if exists "read" on om_item_names;
drop policy if exists "add" on om_item_names;
drop policy if exists "admins remove" on om_item_names;
create policy "read" on om_item_names for select to authenticated using (true);
create policy "add" on om_item_names for insert to authenticated with check (public.has_access('job_om'));
create policy "admins remove" on om_item_names for delete to authenticated using (public.is_admin());
grant select, insert, delete on om_item_names to authenticated;
