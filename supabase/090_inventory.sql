-- =====================================================================
-- 090 · Site inventory (25 Nov)
-- Site › Inventory: stock held in locations (the first is "Workshop 6"). Anyone who can use Site can look at
-- the stock and request items to a site (an inventory request, IR0001…). Only people with "Site › Inventory -
-- ADMIN" (Operations, admins) add locations and items, adjust stock and work the requests. Marking a request
-- "Issued" takes the quantities off the stock. Safe to run again.
-- =====================================================================
create table if not exists inventory_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  notes       text,
  created_at  timestamptz not null default now()
);
create table if not exists inventory_items (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references inventory_locations(id) on delete cascade,
  name         text not null,
  category     text,
  quantity     numeric not null default 0,
  unit         text not null default 'nr',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists inventory_items_loc on inventory_items (location_id);
create table if not exists inventory_requests (
  id               uuid primary key default gen_random_uuid(),
  req_no           bigint generated always as identity,
  job_id           uuid not null references jobs(id) on delete cascade,
  required_by      date,
  notes            text,
  status           text not null default 'new' check (status in ('new', 'ready', 'issued', 'cancelled')),
  requested_by     uuid references profiles(id) on delete set null default auth.uid(),
  requester_name   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists inventory_requests_job on inventory_requests (job_id);
create table if not exists inventory_request_lines (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references inventory_requests(id) on delete cascade,
  item_id     uuid references inventory_items(id) on delete set null,
  item_name   text not null,
  unit        text not null default 'nr',
  quantity    numeric not null check (quantity > 0)
);
create index if not exists inventory_request_lines_req on inventory_request_lines (request_id);

drop trigger if exists t_inventory_items_upd on inventory_items;
create trigger t_inventory_items_upd before update on inventory_items for each row execute function set_updated_at();
drop trigger if exists t_inventory_requests_upd on inventory_requests;
create trigger t_inventory_requests_upd before update on inventory_requests for each row execute function set_updated_at();

-- issuing a request takes its quantities off the stock (once: only when the status changes to 'issued')
create or replace function public.inventory_issue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    update inventory_items i set quantity = greatest(i.quantity - l.quantity, 0)
      from inventory_request_lines l where l.request_id = new.id and l.item_id = i.id;
  end if;
  return new;
end $$;
drop trigger if exists t_inventory_issue on inventory_requests;
create trigger t_inventory_issue after update of status on inventory_requests for each row execute function public.inventory_issue();

-- who can do what
alter table inventory_locations enable row level security;
alter table inventory_items enable row level security;
alter table inventory_requests enable row level security;
alter table inventory_request_lines enable row level security;
drop policy if exists "read" on inventory_locations;
drop policy if exists "manage" on inventory_locations;
drop policy if exists "read" on inventory_items;
drop policy if exists "manage" on inventory_items;
drop policy if exists "read or raise" on inventory_requests;
drop policy if exists "raise" on inventory_requests;
drop policy if exists "work" on inventory_requests;
drop policy if exists "read or raise" on inventory_request_lines;
drop policy if exists "raise" on inventory_request_lines;
drop policy if exists "work" on inventory_request_lines;
create policy "read" on inventory_locations for select to authenticated using (true);
create policy "manage" on inventory_locations for all to authenticated using (public.has_access('buyer_inventory')) with check (public.has_access('buyer_inventory'));
create policy "read" on inventory_items for select to authenticated using (true);
create policy "manage" on inventory_items for all to authenticated using (public.has_access('buyer_inventory')) with check (public.has_access('buyer_inventory'));
-- requests: everyone sees the ones they raised; the inventory admins see and work them all
create policy "read or raise" on inventory_requests for select to authenticated using (requested_by = auth.uid() or public.has_access('buyer_inventory'));
create policy "raise" on inventory_requests for insert to authenticated with check (requested_by = auth.uid());
create policy "work" on inventory_requests for update to authenticated using (public.has_access('buyer_inventory') or (requested_by = auth.uid() and status = 'new'))
  with check (public.has_access('buyer_inventory') or (requested_by = auth.uid() and status in ('new', 'cancelled')));
create policy "read or raise" on inventory_request_lines for select to authenticated
  using (exists (select 1 from inventory_requests r where r.id = request_id and (r.requested_by = auth.uid() or public.has_access('buyer_inventory'))));
create policy "raise" on inventory_request_lines for insert to authenticated
  with check (exists (select 1 from inventory_requests r where r.id = request_id and r.requested_by = auth.uid()));
create policy "work" on inventory_request_lines for all to authenticated using (public.has_access('buyer_inventory')) with check (public.has_access('buyer_inventory'));

-- the new part of the access grid: Operations get it to start with (change in Settings › Access)
insert into role_access (role, section) values ('operations', 'buyer_inventory') on conflict do nothing;

-- the first location
insert into inventory_locations (name) values ('Workshop 6') on conflict (name) do nothing;
