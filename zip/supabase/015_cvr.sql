-- =====================================================================
-- 015 · CVR (cost value reconciliation), monthly per job
-- Builds on the CVR tables from 001 (packages, cost_imports, cost_lines,
-- cvrs). Agreed with Richard 20 Nov (docs/decisions.md "CVR: built"):
-- - packages: budgets from the office SoW (both layouts); a target that
--   can be typed with a note; OH&P / DuB management / design shown and
--   omitted; EP / contingency at a % of the contract sum
-- - iPlicit job costing report imported each month; each supplier
--   allocated to a package once (can be split), remembered for the job
-- - overspends show and reduce the margin; only agreed VOs count
-- - a CVR is a draft until finalised, then its figures are kept as issued
-- No existing data is lost.
-- =====================================================================

-- packages: the job's cost packages from the office SoW
alter table packages add column if not exists kind text not null default 'cost';
alter table packages drop constraint if exists packages_kind_check;
alter table packages add constraint packages_kind_check check (kind in ('cost', 'omit', 'ep'));
alter table packages add column if not exists target numeric(14,2);      -- typed cost target (replaces the budget)
alter table packages add column if not exists target_note text;          -- why, e.g. "Logik order", "90% of budget"
alter table packages add column if not exists supplier_note text;        -- who it's with, e.g. "MGT", "Client Direct"
create unique index if not exists packages_job_name on packages (job_id, name);
alter table packages enable row level security;
drop policy if exists "signed-in users" on packages;
create policy "signed-in users" on packages for all to authenticated using (true) with check (true);

alter table jobs add column if not exists cvr_ep_pct numeric(5,2) not null default 4;   -- EP / contingency, % of contract sum
alter table jobs add column if not exists cvr_budget_file text;                          -- office SoW the budgets came from
alter table jobs add column if not exists cvr_budget_total numeric(14,2);                -- its total (checked against the contract sum)
alter table jobs add column if not exists cvr_budget_imported_at timestamptz;

-- agreed VOs: their cost (build-up before OH&P and prelims) goes to a package's target
alter table variations add column if not exists cvr_package_id uuid references packages(id) on delete set null;

-- the iPlicit job costing report
alter table cost_imports add column if not exists file_name text;
alter table cost_imports add column if not exists report_date date;      -- "PREPARED" date on the report
alter table cost_lines add column if not exists po_total numeric(14,2);  -- iPlicit purchase order total (memorandum only)
alter table cost_lines add column if not exists this_period numeric(14,2);
alter table cost_lines add column if not exists outstanding numeric(14,2);
alter table cost_lines add column if not exists explanation text;
alter table cost_lines add column if not exists sort int not null default 0;
alter table cost_imports enable row level security;
alter table cost_lines enable row level security;
drop policy if exists "signed-in users" on cost_imports;
drop policy if exists "signed-in users" on cost_lines;
create policy "signed-in users" on cost_imports for all to authenticated using (true) with check (true);
create policy "signed-in users" on cost_lines for all to authenticated using (true) with check (true);

-- which package each supplier's costs go to (split by share), remembered for the job
create table if not exists supplier_packages (
  job_id         uuid not null references jobs(id) on delete cascade,
  supplier_code  text not null default '',
  supplier_name  text not null default '',
  package_id     uuid not null references packages(id) on delete cascade,
  share          numeric(7,4) not null default 1 check (share > 0 and share <= 1),
  primary key (job_id, supplier_code, supplier_name, package_id)
);
alter table supplier_packages enable row level security;
drop policy if exists "signed-in users" on supplier_packages;
create policy "signed-in users" on supplier_packages for all to authenticated using (true) with check (true);

-- the CVR itself
alter table cvrs add column if not exists prepared_date date;
alter table cvrs add column if not exists status text not null default 'draft';
alter table cvrs drop constraint if exists cvrs_status_check;
alter table cvrs add constraint cvrs_status_check check (status in ('draft', 'final'));
alter table cvrs add column if not exists possible_reduction numeric(14,2) not null default 0;
alter table cvrs add column if not exists notes text;
alter table cvrs enable row level security;
drop policy if exists "signed-in users" on cvrs;
create policy "signed-in users" on cvrs for all to authenticated using (true) with check (true);

-- a package's forecast for one CVR, when it isn't the target (with the reason)
create table if not exists cvr_package_forecasts (
  cvr_id      uuid not null references cvrs(id) on delete cascade,
  package_id  uuid not null references packages(id) on delete cascade,
  forecast    numeric(14,2),
  note        text,
  primary key (cvr_id, package_id)
);
alter table cvr_package_forecasts enable row level security;
drop policy if exists "signed-in users" on cvr_package_forecasts;
create policy "signed-in users" on cvr_package_forecasts for all to authenticated using (true) with check (true);
