-- =====================================================================
-- 055 · Which PQQ / account form goes to whom (23 Nov)
-- DBP has four forms: PQQ (subcontractor), PQQ B (sole trader / small
-- subcontractor), PQQ C (consultant) and the New Supplier Account form.
-- - each PQQ library document (Settings › Standard documents) says which
--   it is for; blank = goes with every form (e.g. the insurance requirements)
-- - each company has its form: blank = by its type (subcontractor → PQQ,
--   supplier → New Supplier form, consultant / designer → PQQ C); sole
--   traders are set to PQQ B on the company
-- Safe to run more than once. No existing data is lost (run after 054).
-- =====================================================================
alter table standard_documents add column if not exists pack text;
alter table standard_documents drop constraint if exists standard_documents_pack_check;
alter table standard_documents add constraint standard_documents_pack_check
  check (pack is null or pack in ('subcontractor', 'sole_trader', 'consultant', 'supplier'));
alter table companies add column if not exists pqq_pack text;
alter table companies drop constraint if exists companies_pqq_pack_check;
alter table companies add constraint companies_pqq_pack_check
  check (pqq_pack is null or pqq_pack in ('subcontractor', 'sole_trader', 'consultant', 'supplier'));
