-- =====================================================================
-- 094 - Proposed start date, proposed duration and CDP items on an enquiry
-- Part of the project build-out on Estimating > New enquiry. Safe to run more than once. No existing data is touched.
-- =====================================================================

alter table enquiries add column if not exists proposed_start    date;  -- proposed start on site
alter table enquiries add column if not exists proposed_duration text;  -- e.g. "26 weeks"
alter table enquiries add column if not exists cdp_items         text;  -- Contractor's Design Portion items, one per line
