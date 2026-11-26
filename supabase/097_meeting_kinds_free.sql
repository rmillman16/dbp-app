-- =====================================================================
-- 097 · Meeting kinds: new standard list, and kinds a job adds for itself (26 Nov)
-- The kinds are now Pre-Contract, Client - Formal, Client - Informal, Sub-Contractor Coordination and Workshop, and a job can add its
-- own with the + button. So the kind is stored as plain text and the fixed list from 096 is removed. Run after 096. Safe to run again.
-- =====================================================================
alter table meetings drop constraint if exists meetings_meeting_format_check;
notify pgrst, 'reload schema';
