-- =====================================================================
-- 095 · Only admins can delete a programme or a saved revision (26 Nov)
-- The Programme › History dialog lets admins delete a revision, or a whole programme made in error. This makes the database
-- refuse anyone else, whatever the screen shows. Nothing in the app deletes a programme row except this. Run after 094.
-- Safe to run again.
-- =====================================================================
drop policy if exists "admins delete programmes" on programmes;
create policy "admins delete programmes" on programmes as restrictive for delete to authenticated using (public.is_admin());
drop policy if exists "admins delete programme revisions" on programme_revisions;
create policy "admins delete programme revisions" on programme_revisions as restrictive for delete to authenticated using (public.is_admin());
