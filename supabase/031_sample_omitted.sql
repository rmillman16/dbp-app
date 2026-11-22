-- =====================================================================
-- 031 · Sampling: an "Omitted" status
-- Richard, 22 Nov: "add status option for omitted too so we can do it
-- contractor side if client doesn't update". An omitted sample is not on
-- the bell (the reminder only covers samples not yet submitted).
-- No existing data is lost.
-- =====================================================================

alter type sample_status add value if not exists 'omitted';
