-- =====================================================================
-- 024 · Procurement: a package's own name
-- Richard, 21 Nov: "package needs to be editable so I can say electrical
-- (install) or tile (supply) or any number of other items". The name is a
-- label only: the package still takes its budget from the SoW by its SoW
-- name (description). Lead time now includes the design period, so the
-- separate design weeks aren't used any more (kept, nothing deleted).
-- No existing data is lost.
-- =====================================================================

alter table procurement_items add column if not exists display_name text;
