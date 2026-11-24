-- =====================================================================
-- 086 · Monday briefing (24 Nov)
-- Every Monday morning (UK time, from 5am) the send-emails function emails each du Boulay person a friendly summary of their week:
-- what is overdue, what falls due in the next 7 days, and what they closed last week. This table records who has had this week's,
-- so nobody gets it twice. Nothing else changes. Run after 085, then redeploy send-emails. Safe to run more than once.
-- Switch it off for yourself with "email notifications" in My details.
-- =====================================================================
create table if not exists weekly_briefings (
  profile_id uuid not null references profiles(id) on delete cascade,
  week_start date not null,                    -- the Monday it was for
  sent_at    timestamptz not null default now(),
  primary key (profile_id, week_start)
);
alter table weekly_briefings enable row level security;   -- no policy: only the server uses it
grant select, insert, update, delete on weekly_briefings to service_role;
