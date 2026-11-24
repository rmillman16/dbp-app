-- =====================================================================
-- 079 · Sending a snag back (24 Nov)
-- When a trade says a snag is done and the approver finds it isn't done, or isn't to a good enough standard, they send it back with
-- a reason. It goes back on the trade's list as "to do" with the reason and a count of how many times it has been sent back; the
-- photos from the failed attempt are kept as "previous" (not shown to the trade as this attempt's proof). Safe to run more than once.
-- =====================================================================
alter table snags
  add column if not exists rejected_at  timestamptz,
  add column if not exists reject_note  text,
  add column if not exists reject_count int not null default 0;

alter table snag_files drop constraint if exists snag_files_kind_check;
alter table snag_files add constraint snag_files_kind_check check (kind in ('raised', 'proof', 'previous'));
