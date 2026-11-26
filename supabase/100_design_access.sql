-- =====================================================================
-- 100 · Job › Design in the access grid (26 Nov)
-- A new part of the app for the Design profile type. Ticked for Design and Project manager to start; change it in Settings › Access.
-- Run after 099. Safe to run again.
-- =====================================================================
insert into role_access (role, section) values ('design', 'job_design'), ('project_manager', 'job_design') on conflict do nothing;
notify pgrst, 'reload schema';
