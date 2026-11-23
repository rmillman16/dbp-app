-- =====================================================================
-- 017 · CVR: split a supplier's cost by £ as well as by %
-- Agreed with Richard 20 Nov: a supplier covering more than one package
-- can be split by percentage or by amount. A £ split stays fixed in £:
-- if the supplier's total changes in a later report, the difference
-- shows as not allocated (with a warning) until the split is updated.
-- No existing data is lost (existing splits stay as percentages).
-- =====================================================================

alter table supplier_packages add column if not exists amount numeric(14,2);  -- set = split by £ (share kept for reference)
