-- =====================================================================
-- 025 · Programme (Timeline) in the app: editing
-- Richard, 21 Nov: "I forgot we haven't implemented Timeline, I think it's
-- time" — built into the app (not waiting to merge the old Timeline app),
-- first the Gantt chart and editing. A job's programme (imported, made
-- from the SoW, or started blank) is edited here; the cashflow and
-- procurement read it as before.
-- - trade colours and shutdowns (e.g. Christmas) per programme
-- - room on each task for its links and progress (used next)
-- No existing data is lost.
-- =====================================================================

alter table programmes add column if not exists trades jsonb not null default '[]'::jsonb;     -- [{ name, color }]
alter table programmes add column if not exists shutdowns jsonb not null default '[]'::jsonb;  -- [{ name, start, end }]
alter table programme_tasks add column if not exists predecessors text[] not null default '{}';
alter table programme_tasks add column if not exists progress int not null default 0 check (progress between 0 and 100);
