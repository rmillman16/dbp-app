-- =====================================================================
-- 003 · Let signed-in users reach the tables
-- This Supabase project doesn't hand out table access automatically, so
-- after 001 the app's signed-in users got "permission denied". This gives
-- the "authenticated" role (anyone signed in) access to every table, view
-- and function in public, and does the same for anything added later.
-- Signed-out visitors ("anon") still get nothing. Row level security from
-- 001 stays on. No tables or data are changed.
-- =====================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- tables, sequences and functions created by future scripts get the same access
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
