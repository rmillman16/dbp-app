-- =====================================================================
-- 012 · Subcontract payment notices: the details 001 didn't have
-- Layout follows 2609 Kong / Logik Payment Notice 2; test cases are the
-- 2611 Lumen (due £56,401.94) and Mercury (due £44,056.19) notices.
-- - orders: the trade (for "NN - Trade - Subcontractor" folders), notes
-- - subcontractors' applications: their stated previous figure, notes
-- - payment notices: the previous notice's figures when that notice was
--   made outside the app (e.g. Lumen PN 1), notes printed on the notice
-- - DuB adjustment lines: which block they adjust (measured / variations
--   / materials), e.g. "Prelims at the stated 25% not 30%: -£200"
-- - companies: everyone signed in can keep the contractor list up to date
-- No existing data is lost.
-- =====================================================================

alter table orders add column if not exists trade text;
alter table orders add column if not exists notes text;

alter table sub_applications add column if not exists stated_previous numeric(14,2);
alter table sub_applications add column if not exists notes text;

alter table payment_notices add column if not exists prev_measured numeric(14,2);
alter table payment_notices add column if not exists prev_variations numeric(14,2);
alter table payment_notices add column if not exists prev_materials numeric(14,2);
alter table payment_notices add column if not exists prev_loss_and_expense numeric(14,2);
alter table payment_notices add column if not exists prev_contra numeric(14,2);
alter table payment_notices add column if not exists notes text;

alter table payment_notice_adjustments add column if not exists block text not null default 'measured'
  check (block in ('measured', 'variations', 'materials'));
alter table payment_notice_adjustments add column if not exists sort int not null default 0;

create index if not exists orders_job on orders (job_id);
create index if not exists sub_application_lines_app on sub_application_lines (sub_application_id, sort);
