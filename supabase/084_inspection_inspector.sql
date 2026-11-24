-- =====================================================================
-- 084 · Inspections: the inspector's name (24 Nov)
-- The Job › H&S › Inspections tracker is just one log of the external H&S inspections on a job: the date, the inspector's name and the
-- report. One schedule per job (how often, who is reminded) sits behind it in hs_trackers. Run after 083. Safe to run more than once.
-- =====================================================================
alter table hs_reports add column if not exists inspector text;
