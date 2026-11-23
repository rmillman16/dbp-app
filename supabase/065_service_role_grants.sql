-- =====================================================================
-- 065 · Let the server (service_role) use the tables the Edge Functions read and write (23 Nov)
-- The outside-access function ("external") reads and writes as the server's service_role, which skips row security but still
-- needs the ordinary table permission. Some tables made by recent scripts (external_links, the RFI and submittal tables…)
-- didn't give it that, so a private link said "permission denied for table external_links".
-- - gives service_role full use of every table, sequence and function in the public schema, and of any made later
-- - changes nothing for staff, and still nothing for outside people: they never connect to the database at all, only to the
--   external function, which checks who they are first
-- Safe to run more than once. No existing data is lost (run after 064).
-- =====================================================================
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
