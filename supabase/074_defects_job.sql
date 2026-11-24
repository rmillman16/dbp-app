-- =====================================================================
-- 074 · "Defects" overarching job (24 Nov)
-- One catch-all job, 0 DEFECTS, so material and hire requisitions can be raised for defect work on an old job, or one that predates
-- the new system. It appears in the requisition forms' site list like any live job; the form then asks which job the work is for.
-- Safe to run more than once. Nothing existing is changed.
-- =====================================================================
insert into jobs (job_no, code, name, status)
values (0, 'DEFECTS', 'Defects (old jobs and jobs before the app)', 'live')
on conflict (job_no, code) do nothing;
