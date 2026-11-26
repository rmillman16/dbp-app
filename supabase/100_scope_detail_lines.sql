-- =====================================================================
-- 100 · Tender scope: detail lines (26 Nov)
-- A scope item can have detail lines under it (the numbered points in the enquiry email). They go out in the email but are
-- not levelled: the item above them is the row in the levelling grid. Adds 'detail' to the allowed kinds. Safe to run again.
-- =====================================================================
alter table tender_scope_items drop constraint if exists tender_scope_items_kind_check;
alter table tender_scope_items add constraint tender_scope_items_kind_check check (kind in ('heading', 'item', 'detail'));
