-- =====================================================================
-- 004 · Variations: add the VO date
-- The VO sheet and summary show a "Date" for every VO (the date it was
-- raised), including VOs not yet issued. 001 only had date issued and
-- date agreed, so this adds vo_date. Existing VOs (if any) get the date
-- they were created. No data is lost.
-- =====================================================================

alter table variations add column if not exists vo_date date not null default current_date;
update variations set vo_date = created_at::date where vo_date <> created_at::date;
