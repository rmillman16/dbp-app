-- =====================================================================
-- 028 · Programme: mark a task as on the critical path
-- Richard, 22 Nov: "when you create a new item need to be a checkbox to
-- add an item as critical path". The app still works the critical path
-- out from the links; a ticked task is always shown (and printed) as
-- critical as well.
-- No existing data is lost.
-- =====================================================================

alter table programme_tasks add column if not exists critical boolean not null default false;
