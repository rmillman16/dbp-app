-- =====================================================================
-- 020 · Cashflow: a package's weighting by £ as well as by %
-- Richard, 20 Nov: "weighting should be able to be done both by value and %".
-- A stage with an amount is a fixed £; without one it's its % of the value.
-- No existing data is lost.
-- =====================================================================

alter table cashflow_weights add column if not exists amount numeric(14,2);
