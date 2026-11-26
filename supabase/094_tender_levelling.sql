-- =====================================================================
-- 094 · Tender levelling (26 Nov)
-- A package's scope becomes a LIST of items (typed in the tender enquiry, or added later). Each contractor's return is then
-- levelled against that list: per item, is it included in their price or excluded (with the £ the estimator allows to
-- plug the gap, and why), plus items they added below the line. Everyone signed in can edit; every change is written to
-- tender_activity by a trigger, which nobody can edit or delete from the app. Safe to run again.
-- =====================================================================
create table if not exists tender_scope_items (
  id          uuid primary key default gen_random_uuid(),
  package_id  uuid not null references tender_packages(id) on delete cascade,
  sort        int  not null default 0,
  kind        text not null default 'item' check (kind in ('heading', 'item')),
  description text not null,
  created_at  timestamptz not null default now()
);
create index if not exists tender_scope_items_package on tender_scope_items (package_id, sort);

-- one cell of the grid: a contractor against a scope item
create table if not exists tender_level_cells (
  id            uuid primary key default gen_random_uuid(),
  invite_id     uuid not null references tender_invites(id) on delete cascade,
  item_id       uuid not null references tender_scope_items(id) on delete cascade,
  status        text not null default 'tbc' check (status in ('tbc', 'included', 'excluded')),
  their_amount  numeric(14,2),              -- their price for the item, where they gave one (information)
  plug_amount   numeric(14,2),              -- what the estimator allows for it when excluded (added to the levelled total)
  note          text,
  updated_at    timestamptz not null default now(),
  unique (invite_id, item_id)
);
create index if not exists tender_level_cells_item on tender_level_cells (item_id);

-- items a contractor added that are not in the scope, qualifications, provisional sums (below the line); a negative amount deducts
create table if not exists tender_level_extras (
  id          uuid primary key default gen_random_uuid(),
  invite_id   uuid not null references tender_invites(id) on delete cascade,
  description text not null,
  amount      numeric(14,2) not null default 0,
  note        text,
  updated_at  timestamptz not null default now()
);
create index if not exists tender_level_extras_invite on tender_level_extras (invite_id);

-- who did what (written by the triggers below only)
create table if not exists tender_activity (
  id          uuid primary key default gen_random_uuid(),
  package_id  uuid references tender_packages(id) on delete cascade,
  at          timestamptz not null default now(),
  by_user     uuid default auth.uid(),
  action      text not null,
  detail      text not null
);
create index if not exists tender_activity_package on tender_activity (package_id, at desc);

drop trigger if exists t_tender_level_cells_upd on tender_level_cells;
create trigger t_tender_level_cells_upd before update on tender_level_cells for each row execute function set_updated_at();
drop trigger if exists t_tender_level_extras_upd on tender_level_extras;
create trigger t_tender_level_extras_upd before update on tender_level_extras for each row execute function set_updated_at();

alter table tender_scope_items enable row level security;
alter table tender_level_cells enable row level security;
alter table tender_level_extras enable row level security;
alter table tender_activity enable row level security;
grant select, insert, update, delete on tender_scope_items, tender_level_cells, tender_level_extras to authenticated;
grant select on tender_activity to authenticated;
drop policy if exists "signed-in users" on tender_scope_items;
create policy "signed-in users" on tender_scope_items for all to authenticated using (true) with check (true);
drop policy if exists "signed-in users" on tender_level_cells;
create policy "signed-in users" on tender_level_cells for all to authenticated using (true) with check (true);
drop policy if exists "signed-in users" on tender_level_extras;
create policy "signed-in users" on tender_level_extras for all to authenticated using (true) with check (true);
drop policy if exists "read" on tender_activity;
-- no insert / update / delete policy on tender_activity: the app cannot touch it
create policy "read" on tender_activity for select to authenticated using (true);

-- ---------- the activity log ----------
create or replace function tender_log() returns trigger language plpgsql security definer set search_path = public as $$
declare
  r      jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  o      jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  pkg    uuid;
  who    text;
  what   text;
  detail text;
begin
  if tg_table_name = 'tender_scope_items' then
    pkg := (r->>'package_id')::uuid;
    -- re-ordering is not logged
    if tg_op = 'UPDATE' and o->>'description' = r->>'description' then return null; end if;
    insert into tender_activity (package_id, action, detail)
      values (pkg, 'scope ' || lower(tg_op), coalesce(r->>'description', ''));
  elsif tg_table_name = 'tender_level_cells' then
    select i.package_id, i.name into pkg, who from tender_invites i where i.id = (r->>'invite_id')::uuid;
    select s.description into what from tender_scope_items s where s.id = (r->>'item_id')::uuid;
    -- the package is being deleted
    if pkg is null then return null; end if;
    detail := who || ' · ' || coalesce(what, '(item)') || ': ' || (r->>'status')
      || case when r->>'their_amount' is not null then ', their £' || (r->>'their_amount') else '' end
      || case when r->>'plug_amount' is not null then ', plug £' || (r->>'plug_amount') else '' end
      || case when coalesce(r->>'note', '') <> '' then ' (' || (r->>'note') || ')' else '' end;
    if tg_op = 'UPDATE' then
      detail := detail || '   [was ' || (o->>'status')
        || case when o->>'their_amount' is not null then ', their £' || (o->>'their_amount') else '' end
        || case when o->>'plug_amount' is not null then ', plug £' || (o->>'plug_amount') else '' end || ']';
    end if;
    insert into tender_activity (package_id, action, detail) values (pkg, 'level ' || lower(tg_op), detail);
  elsif tg_table_name = 'tender_level_extras' then
    select i.package_id, i.name into pkg, who from tender_invites i where i.id = (r->>'invite_id')::uuid;
    if pkg is null then return null; end if;
    insert into tender_activity (package_id, action, detail)
      values (pkg, 'below the line ' || lower(tg_op), who || ' · ' || (r->>'description') || ' £' || (r->>'amount')
        || case when coalesce(r->>'note', '') <> '' then ' (' || (r->>'note') || ')' else '' end);
  elsif tg_table_name = 'tender_invites' then
    if tg_op = 'UPDATE' and (o->>'quote_amount') is not distinct from (r->>'quote_amount') and (o->>'status') is not distinct from (r->>'status') then return null; end if;
    insert into tender_activity (package_id, action, detail)
      values ((r->>'package_id')::uuid, 'quote',
        (r->>'name') || ': ' || (r->>'status') || case when r->>'quote_amount' is not null then ', their price £' || (r->>'quote_amount') else '' end
        || case when tg_op = 'UPDATE' then '   [was ' || (o->>'status') || case when o->>'quote_amount' is not null then ', £' || (o->>'quote_amount') else '' end || ']' else '' end);
  end if;
  return null;
end $$;

drop trigger if exists t_log_scope_items on tender_scope_items;
create trigger t_log_scope_items after insert or update or delete on tender_scope_items for each row execute function tender_log();
drop trigger if exists t_log_level_cells on tender_level_cells;
create trigger t_log_level_cells after insert or update or delete on tender_level_cells for each row execute function tender_log();
drop trigger if exists t_log_level_extras on tender_level_extras;
create trigger t_log_level_extras after insert or update or delete on tender_level_extras for each row execute function tender_log();
drop trigger if exists t_log_invites on tender_invites;
create trigger t_log_invites after update of quote_amount, status on tender_invites for each row execute function tender_log();
