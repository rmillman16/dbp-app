-- =====================================================================
-- 019 · Programme import and the cashflow forecast
-- Agreed with Richard 20 Nov (docs/decisions.md "Cashflow: built"):
-- - the job's programme is imported from the file saved from DBP Timeline
--   (P6 .xer, or Timeline's own file) and re-imported on each revision;
--   activities are kept by their ID (A1010…) so links survive a revision
-- - the cashflow spreads each SoW section (and prelims, agreed VOs, issued
--   VOs at risk) over the programme in payment stages: Deposit, Progress,
--   Delivery, Installation… renamed, added or removed per job; each stage
--   has a % and falls at the start of, spread across, or at the end of
--   activities, or on a date
-- No existing data is lost.
-- =====================================================================

-- the job's programme (the latest import is the one used)
create table if not exists programmes (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  file_name     text,
  project_name  text,
  start_date    date,
  finish_date   date,
  imported_at   timestamptz not null default now()
);
create index if not exists programmes_job on programmes (job_id, imported_at);

create table if not exists programme_tasks (
  id            uuid primary key default gen_random_uuid(),
  programme_id  uuid not null references programmes(id) on delete cascade,
  code          text not null,          -- activity ID, e.g. A1220
  name          text not null,
  section       text,                   -- WBS heading, e.g. "L2 to B4 - Public & Amenity Areas"
  trade         text,                   -- e.g. "Joinery & Fit-out"
  start_date    date not null,
  finish_date   date not null,
  milestone     boolean not null default false,
  sort          int not null default 0
);
create index if not exists programme_tasks_prog on programme_tasks (programme_id, sort);

-- the job's payment stages (a guide to start with; renamed, added, removed per job)
create table if not exists cashflow_stages (
  id      uuid primary key default gen_random_uuid(),
  job_id  uuid not null references jobs(id) on delete cascade,
  name    text not null,
  sort    int not null default 0
);
create index if not exists cashflow_stages_job on cashflow_stages (job_id, sort);

-- each item (SoW section "sow:3", prelims, a VO "vo:<id>") and the activities it's linked to
create table if not exists cashflow_items (
  job_id      uuid not null references jobs(id) on delete cascade,
  item_key    text not null,
  task_codes  text[] not null default '{}',
  primary key (job_id, item_key)
);

-- an item's weighting: % per stage, and when that stage falls
create table if not exists cashflow_weights (
  job_id      uuid not null references jobs(id) on delete cascade,
  item_key    text not null,
  stage_id    uuid not null references cashflow_stages(id) on delete cascade,
  pct         numeric(7,4) not null default 0,       -- 0–100
  timing      text not null default 'spread' check (timing in ('start', 'spread', 'end', 'date')),
  task_codes  text[],                                -- blank = the item's linked activities
  on_date     date,                                  -- when timing is 'date'
  primary key (job_id, item_key, stage_id)
);

alter table programmes enable row level security;
alter table programme_tasks enable row level security;
alter table cashflow_stages enable row level security;
alter table cashflow_items enable row level security;
alter table cashflow_weights enable row level security;
drop policy if exists "signed-in users" on programmes;
drop policy if exists "signed-in users" on programme_tasks;
drop policy if exists "signed-in users" on cashflow_stages;
drop policy if exists "signed-in users" on cashflow_items;
drop policy if exists "signed-in users" on cashflow_weights;
create policy "signed-in users" on programmes for all to authenticated using (true) with check (true);
create policy "signed-in users" on programme_tasks for all to authenticated using (true) with check (true);
create policy "signed-in users" on cashflow_stages for all to authenticated using (true) with check (true);
create policy "signed-in users" on cashflow_items for all to authenticated using (true) with check (true);
create policy "signed-in users" on cashflow_weights for all to authenticated using (true) with check (true);
