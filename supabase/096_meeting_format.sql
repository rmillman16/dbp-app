-- =====================================================================
-- 096 · Meeting kind: internal, external, 1-to-1 or workshop (26 Nov)
-- Every meeting can be marked as what kind of meeting it was, so the list shows at a glance which are internal, which were with
-- the client or other outside people, which were one to ones and which were workshops. Run after 095. Safe to run again.
-- =====================================================================
alter table meetings add column if not exists meeting_format text;
alter table meetings drop constraint if exists meetings_meeting_format_check;
alter table meetings add constraint meetings_meeting_format_check check (meeting_format is null or meeting_format in ('internal', 'external', 'one_to_one', 'workshop'));
