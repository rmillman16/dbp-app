-- =====================================================================
-- 044 · Company dashboard: who sees it (22 Nov)
-- The dashboard (sidebar › Dashboard) is a new part of the app in Settings ›
-- Access. Starting ticks: Project manager and Commercial (admins and anyone
-- with no type yet see it anyway). Change them in Settings › Access.
-- It shows only figures from parts each person can already open.
-- No existing data is lost.
-- =====================================================================

insert into role_access (role, section) values ('project_manager', 'dashboard'), ('commercial', 'dashboard')
on conflict do nothing;
