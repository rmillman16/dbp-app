-- =====================================================================
-- 007 · Estimating: quotations not linked to a job
-- Small works and new enquiries are quoted before (or without) a job
-- existing. A quotation can now have no job; it then carries its own
-- project name, and is numbered in its own series (EST – QU001, QU002…)
-- separate from each job's quotations. No existing data is lost.
-- =====================================================================

alter table quotations alter column job_id drop not null;
alter table quotations add column if not exists project_name text;   -- used when there's no job

-- job quotations stay numbered per job (existing rule); estimating ones share one series
create unique index if not exists quotations_estimating_no on quotations (quote_no) where job_id is null;
