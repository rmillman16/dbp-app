-- =====================================================================
-- 023 · Procurement schedule
-- Builds on procurement_items from 001 (one row per package, section A
-- from the SoW, section B per VO). Agreed with Richard 19 + 21 Nov
-- (docs/decisions.md "Procurement: built"):
-- - packages from the office SoW, the general columns (Subbie, Labour,
--   Materials) read line by line from their descriptions, as the cashflow
-- - any SoW line can be moved to another package, or its £ split across
--   packages (e.g. a bar: mirrors, joinery, metalwork, install)
-- - appointed subcontractor and order value typed, or taken from an order
-- No existing data is lost.
-- =====================================================================

alter table procurement_items add column if not exists company_id uuid references companies(id) on delete set null;
alter table procurement_items add column if not exists order_value numeric(14,2);
alter table procurement_items add column if not exists order_no text;
alter table procurement_items add column if not exists order_date date;
-- section A rows are the job's packages by name; section B one per VO
create unique index if not exists procurement_items_job_pkg on procurement_items (job_id, description) where section = 'contract';
create unique index if not exists procurement_items_vo on procurement_items (variation_id) where variation_id is not null;
alter table procurement_items enable row level security;
drop policy if exists "signed-in users" on procurement_items;
create policy "signed-in users" on procurement_items for all to authenticated using (true) with check (true);

-- a SoW line moved to another package, or split across packages by £ (what isn't given here
-- follows the SoW's own split)
create table if not exists procurement_splits (
  job_id    uuid not null references jobs(id) on delete cascade,
  line_key  text not null,          -- the SoW item number (or its description)
  package   text not null,
  amount    numeric(14,2) not null,
  primary key (job_id, line_key, package)
);
alter table procurement_splits enable row level security;
drop policy if exists "signed-in users" on procurement_splits;
create policy "signed-in users" on procurement_splits for all to authenticated using (true) with check (true);
