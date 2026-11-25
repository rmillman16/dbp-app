-- =====================================================================
-- 092 · Inventory: item codes (W6-0001…) and archiving (25 Nov)
-- - Every item gets a unique code: the location's short prefix, a dash and a number, e.g. W6-0001, so it can be
--   labelled or barcoded later. Existing items are numbered in the order they were added. New locations have a
--   prefix of their own (Workshop 6 = W6). The number runs on across all locations, so a code is never reused.
-- - An item that is lost and was the last one in stock is archived: it drops off the stock list and the request
--   form, but is kept (with its code) so it can be restored if we get another. Marking one returned un-archives it.
-- Run after 091. Safe to run again.
-- =====================================================================
alter table inventory_locations add column if not exists prefix text;
update inventory_locations set prefix = 'W6' where name = 'Workshop 6' and prefix is null;

create sequence if not exists inventory_item_seq;
alter table inventory_items add column if not exists code text;
alter table inventory_items add column if not exists archived boolean not null default false;

create or replace function public.inventory_item_code(loc uuid) returns text
language sql security definer set search_path = public as $$
  select coalesce((select nullif(btrim(prefix), '') from inventory_locations where id = loc), 'W6') || '-'
         || (select case when n < 10000 then lpad(n::text, 4, '0') else n::text end from (select nextval('inventory_item_seq') as n) s)
$$;

-- number the items that already exist, oldest first
do $$
declare r record;
begin
  for r in select id, location_id from inventory_items where code is null order by created_at, id loop
    update inventory_items set code = public.inventory_item_code(r.location_id) where id = r.id;
  end loop;
end $$;

create unique index if not exists inventory_items_code_key on inventory_items (code);

create or replace function public.inventory_item_set_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or btrim(new.code) = '' then new.code := public.inventory_item_code(new.location_id); end if;
  return new;
end $$;
drop trigger if exists t_inventory_item_code on inventory_items;
create trigger t_inventory_item_code before insert on inventory_items for each row execute function public.inventory_item_set_code();

-- lost / returned: a lost last item is archived; a returned one is brought back. Says whether it archived.
drop function if exists public.inventory_line_outcome(uuid, text, numeric);
create function public.inventory_line_outcome(line uuid, outcome text, amount numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  l inventory_request_lines;
  r inventory_requests;
  archived_now boolean := false;
begin
  if not public.has_access('buyer_inventory') then raise exception 'Only the inventory administrators can do this.'; end if;
  if outcome not in ('returned', 'lost') then raise exception 'Unknown outcome.'; end if;
  select * into l from inventory_request_lines where id = line for update;
  if l.id is null then raise exception 'That line has been deleted.'; end if;
  select * into r from inventory_requests where id = l.request_id;
  if r.status <> 'issued' then raise exception 'Only issued requests can have items returned or lost.'; end if;
  if amount is null or amount <= 0 then raise exception 'Enter a quantity above zero.'; end if;
  if amount > l.quantity - l.returned_qty - l.lost_qty then raise exception 'Only % are still out.', l.quantity - l.returned_qty - l.lost_qty; end if;
  if outcome = 'returned' then
    update inventory_request_lines set returned_qty = returned_qty + amount where id = line;
    if l.item_id is not null then update inventory_items set quantity = quantity + amount, archived = false where id = l.item_id; end if;
  else
    update inventory_request_lines set lost_qty = lost_qty + amount where id = line;
    -- the last one (nothing in stock, nothing else of it still out on site) is archived
    if l.item_id is not null
       and (select quantity from inventory_items where id = l.item_id) <= 0
       and not exists (
         select 1 from inventory_request_lines o join inventory_requests q on q.id = o.request_id
          where o.item_id = l.item_id and q.status = 'issued' and o.quantity - o.returned_qty - o.lost_qty > 0
       ) then
      update inventory_items set archived = true where id = l.item_id;
      archived_now := true;
    end if;
  end if;
  return archived_now;
end $$;
grant execute on function public.inventory_line_outcome(uuid, text, numeric) to authenticated;
