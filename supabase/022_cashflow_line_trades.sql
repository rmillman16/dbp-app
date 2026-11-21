-- =====================================================================
-- 022 · Cashflow: the trade of each subcontract line, where it's overruled
-- Richard, 21 Nov: the SoW's subcontract lines are grouped by SoW section in
-- the CVR, and on 2701 the sections are areas ("Basement 2 based on GPAD"),
-- not trades. The app picks each line's trade from its description; a
-- dropdown per line overrules it, and the choice is kept here.
-- No existing data is lost.
-- =====================================================================

create table if not exists cashflow_line_trades (
  job_id    uuid not null references jobs(id) on delete cascade,
  line_key  text not null,          -- the SoW item number (or its description)
  trade     text not null,
  primary key (job_id, line_key)
);
alter table cashflow_line_trades enable row level security;
drop policy if exists "signed-in users" on cashflow_line_trades;
create policy "signed-in users" on cashflow_line_trades for all to authenticated using (true) with check (true);
