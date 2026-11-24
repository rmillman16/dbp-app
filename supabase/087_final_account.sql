-- =====================================================================
-- 087 · Final account on applications (24 Nov)
-- An application can be marked as the final account, so the job's applications show when the project has been finished off.
-- (Practical completion, which halves retention, already exists: applications.practical_completion.) Run after 086. Safe to run more than once.
-- =====================================================================
alter table applications add column if not exists final_account boolean not null default false;
