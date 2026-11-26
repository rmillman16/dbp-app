-- =====================================================================
-- 102 · Applications: a "Checked" step before an application is issued (26 Nov)
-- The steps are now Draft, Checked, Issued (was Submitted), Certified (was Assessed) and Paid. Only "Checked" is new in the database;
-- the other names are just shown differently. Run after 101. Safe to run again.
-- =====================================================================
alter type app_status add value if not exists 'checked' before 'submitted';
notify pgrst, 'reload schema';
