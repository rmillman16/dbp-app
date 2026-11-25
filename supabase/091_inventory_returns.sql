-- =====================================================================
-- 091 · Inventory: items returned or lost (25 Nov)
-- On an issued inventory request, the stores mark each line as returned (goes back into the stock) or lost
-- (not coming back: it stays off the stock, it was taken off when the request was issued). The quantities are
-- kept on the line. Only people with "Site › Inventory - ADMIN". Run after 090. Safe to run again.
-- =====================================================================
alter table inventory_request_lines add column if not exists returned_qty numeric not null default 0;
alter table inventory_request_lines add column if not exists lost_qty numeric not null default 0;

create or replace function public.inventory_line_outcome(line uuid, outcome text, amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  l inventory_request_lines;
  r inventory_requests;
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
    if l.item_id is not null then update inventory_items set quantity = quantity + amount where id = l.item_id; end if;
  else
    update inventory_request_lines set lost_qty = lost_qty + amount where id = line;
  end if;
end $$;
grant execute on function public.inventory_line_outcome(uuid, text, numeric) to authenticated;
