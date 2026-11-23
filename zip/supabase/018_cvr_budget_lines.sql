-- =====================================================================
-- 018 · CVR: the office SoW's lines, kept for the CVR breakdown sheet
-- The CVR export follows Richard's KOSH CVR (20 Nov): a summary sheet and
-- a breakdown sheet listing every SoW item with its cost and OH&P split
-- out into the package columns. Until now only each package's total was
-- kept; this keeps the lines too. Re-import the office SoW on the CVR tab
-- after running this to fill it for a job.
-- No existing data is lost.
-- =====================================================================

create table if not exists cvr_budget_lines (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs(id) on delete cascade,
  sort         int not null,
  kind         text not null check (kind in ('section', 'item', 'line')),
  ref          text,                 -- item number, e.g. "3.04"
  description  text not null default '',
  qty          numeric(14,4),
  unit         text,
  rate         numeric(14,4),
  total        numeric(14,2),        -- item: its SoW total; line: its amount
  shown        text,                 -- a total in words (FOC, Included…)
  amounts      jsonb not null default '{}'::jsonb,  -- package name → amount ("OH&P" for OH&P)
  note         text
);
create index if not exists cvr_budget_lines_job on cvr_budget_lines (job_id, sort);
alter table cvr_budget_lines enable row level security;
drop policy if exists "signed-in users" on cvr_budget_lines;
create policy "signed-in users" on cvr_budget_lines for all to authenticated using (true) with check (true);
grant select, insert, update, delete on cvr_budget_lines to authenticated;
