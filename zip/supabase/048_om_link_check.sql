-- =====================================================================
-- 048 · O&M: can each SharePoint link be opened by anyone? (23 Nov)
-- Richard: as-builts (and the other O&M documents) stay in SharePoint as a
-- link; check the link can be opened by everyone and show a green tick.
-- The check-link Edge Function opens the link with no sign-in, as a client
-- would; the result is kept against the line with the link it was for, so
-- a changed link is checked again.
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

alter table om_requirements add column if not exists link_status text check (link_status in ('public', 'sign_in', 'broken', 'unknown'));
alter table om_requirements add column if not exists link_checked_url text;
alter table om_requirements add column if not exists link_checked_at timestamptz;
