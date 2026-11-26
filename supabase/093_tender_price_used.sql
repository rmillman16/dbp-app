-- =====================================================================
-- 093 · Tender tracker: "Price used" status (26 Nov)
-- The estimator marks which contractor's price went into the estimate, so the QS can see who was used.
-- Adds 'used' to the allowed statuses on tender_invites. Safe to run again.
-- =====================================================================
alter table tender_invites drop constraint if exists tender_invites_status_check;
alter table tender_invites add constraint tender_invites_status_check
  check (status in ('drafted', 'sent', 'interested', 'declined', 'quoted', 'used', 'appointed', 'unsuccessful'));
