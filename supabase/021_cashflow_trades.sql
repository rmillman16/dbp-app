-- =====================================================================
-- 021 · Cashflow by trade: where a package goes in the cashflow
-- Richard, 21 Nov: the cashflow is weighted by trade (joinery, metalwork,
-- mirrors, stone, labour, materials…). The Micro SoW's single Subbie column
-- is split by section in the CVR ("Subbie – 9 Electrical installation"), so
-- each of those goes into a trade (suggested, confirmed once per job).
--   blank   = the app's suggestion
--   ''      = kept as its own row
--   a name  = the package it goes into, e.g. 'Electrical'
-- No existing data is lost.
-- =====================================================================

alter table packages add column if not exists cashflow_trade text;
