-- =====================================================================
-- 072 · BREEAM tracker: the columns of a real tracker (24 Nov)
-- Richard's 17 Corsham Street tracker has Credits Available / Targeted / Achieved, Credit Criteria, Evidence Required and Action
-- (who does it), and some credits are prerequisites ("P") with no credit count. Adds those to breeam_items.
-- Safe to run more than once. No existing data is touched (run after 071).
-- =====================================================================
alter table breeam_items add column if not exists credits_achieved numeric(5,2);
alter table breeam_items add column if not exists criteria         text;
alter table breeam_items add column if not exists evidence         text;
alter table breeam_items add column if not exists prerequisite     boolean not null default false;
