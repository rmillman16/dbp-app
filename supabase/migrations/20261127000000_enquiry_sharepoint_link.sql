-- =====================================================================
-- 104 - SharePoint link on an enquiry (estimating job)
-- The drawings/documents folder belongs to the job, so it is kept on the enquiry and pre-fills each tender package's documents link.
-- Safe to run more than once. No existing data is touched.
-- =====================================================================

alter table enquiries add column if not exists documents_link text;
