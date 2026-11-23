-- =====================================================================
-- 068 - Contract details on an enquiry, and a phone number in My details
-- The tender enquiry generator (067) takes the job's details from the enquiry, and the sender's name and phone from
-- whoever is using it. So the enquiry needs the main contract, sub-contract and a project summary, and each person
-- needs a phone number in My details. Safe to run more than once. No existing data is touched.
-- =====================================================================

alter table enquiries add column if not exists main_contract text;  -- e.g. JCT Design and Build 2016
alter table enquiries add column if not exists sub_contract  text;  -- e.g. JCT Sub-contract
alter table enquiries add column if not exists summary       text;  -- project summary, used in the tender emails

alter table profiles add column if not exists phone text;
grant update (full_name, initials, job_title, email_notifications, phone) on profiles to authenticated;
