-- =====================================================================
-- 027 · Programme: the original (contract) programme to compare against
-- Richard, 22 Nov: "the commit button which becomes the original programme
-- we can come back and compare to later for an EOT etc. would be great to
-- have an overlay feature where the new programme is shown as an overlay
-- on the original programme to see slippage".
-- - which committed revision is the original programme (by its number:
--   1 = Initial issue, 2 = Rev A…). The overlay and the slip shown on the
--   Programme tab compare against it (or any other revision chosen).
-- No existing data is lost.
-- =====================================================================

alter table programmes add column if not exists contract_rev int;  -- rev_no of the original programme (programme_revisions)
