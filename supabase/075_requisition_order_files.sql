-- =====================================================================
-- 075 · Requisition order documents (24 Nov)
-- The buyer can attach order documents to a requisition (receipt, order confirmation, delivery note). They are kept apart from the
-- requester's own attachments ("order"), and when the requisition is set to Ordered they are emailed to the requester with the
-- notice (the send-emails function; redeploy it after this). Safe to run more than once. Existing files stay as "request".
-- =====================================================================
alter table requisition_files add column if not exists kind text not null default 'request' check (kind in ('request', 'order'));
