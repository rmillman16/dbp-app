-- =====================================================================
-- 026 · Programme: every Timeline feature, and programmes for estimating
-- Richard, 22 Nov: "take the layout of Timeline and copy every feature of
-- it"; "within estimating we need to link it to programmes as estimates
-- and tenders often need a programme too".
-- - a programme belongs to a job OR an Estimating enquiry (moves to the
--   job when the enquiry is won)
-- - Timeline's programme settings: programme start, start on site (Wk 1),
--   client logo, section order (including empty sections)
-- - Timeline's task fields: contractor, RAG, prerequisite confirmed and
--   note, skeleton crew (works through shutdowns), baseline
-- - issued revisions (Initial issue, Rev A, Rev B…) with a note and a copy
--   of the programme as it was, for history and "what changed"
-- No existing data is lost.
-- =====================================================================

-- a job's or an enquiry's
alter table programmes alter column job_id drop not null;
alter table programmes add column if not exists enquiry_id uuid references enquiries(id) on delete cascade;
alter table programmes drop constraint if exists programmes_owner;
alter table programmes add constraint programmes_owner check (job_id is not null or enquiry_id is not null);
create index if not exists programmes_enquiry on programmes (enquiry_id);

-- programme settings
alter table programmes add column if not exists project_start date;   -- "Programme starts" (e.g. LOI / precon)
alter table programmes add column if not exists week_start date;      -- "Start on site (Wk 1)"; blank = worked out
alter table programmes add column if not exists client_logo text;     -- the client's logo (image), on the print
alter table programmes add column if not exists sections jsonb not null default '[]'::jsonb;  -- [{ name, collapsed }] in order

-- task fields
alter table programme_tasks add column if not exists contractor text;
alter table programme_tasks add column if not exists rag text not null default 'green';
alter table programme_tasks drop constraint if exists programme_tasks_rag;
alter table programme_tasks add constraint programme_tasks_rag check (rag in ('green', 'amber', 'red'));
alter table programme_tasks add column if not exists prereq_confirmed boolean not null default false;
alter table programme_tasks add column if not exists prereq_note text;
alter table programme_tasks add column if not exists skeleton boolean not null default false;  -- works through shutdowns
alter table programme_tasks add column if not exists baseline_start date;
alter table programme_tasks add column if not exists baseline_duration int;                     -- working days

-- issued revisions
create table if not exists programme_revisions (
  id            uuid primary key default gen_random_uuid(),
  programme_id  uuid not null references programmes(id) on delete cascade,
  rev_no        int not null,               -- 1 = Initial issue, 2 = Rev A, 3 = Rev B…
  note          text,
  data          jsonb not null,             -- the programme as issued, in Timeline's file layout
  task_count    int not null default 0,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (programme_id, rev_no)
);
alter table programme_revisions enable row level security;
drop policy if exists "signed-in users" on programme_revisions;
create policy "signed-in users" on programme_revisions for all to authenticated using (true) with check (true);
grant select, insert, update, delete on programme_revisions to authenticated;
