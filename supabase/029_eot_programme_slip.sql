-- =====================================================================
-- 029 · EOT: quote a programme task's slippage on a delay event
-- Richard, 22 Nov: not every slipped task is an EOT (some are our own or a
-- subcontractor's issues), so it works the other way round: when writing a
-- delay event, pick the programme task it affected and quote its slippage
-- against the original programme. Kept as it was on the day it was quoted
-- (the programme carries on changing).
-- { code, name, compared_with, was_start, was_finish, now_start, now_finish,
--   days, working_days, quoted_on }
-- No existing data is lost.
-- =====================================================================

alter table delay_events add column if not exists programme_slip jsonb;
