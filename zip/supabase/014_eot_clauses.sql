-- =====================================================================
-- 014 · EOT clauses per job and the notice of delay in DBP's style
-- EOT notices and claims must cite the clauses of the job's own contract.
-- Clauses differ on every job (amendments), so there are NO defaults:
-- each job's clauses are typed in on its EOT tab, and each delay event has
-- its own Relevant Event clause. The app won't produce a letter until the
-- clauses it needs are filled in (agreed 20 Nov).
-- The notice follows the letter Richard issued on The Mall Walthamstow
-- (Notice of Delay No 2, 13.08.2025).
-- - jobs: notice / extension of time / loss and expense clauses, and the
--   client contact the letters go "Fao:"
-- - delay events: Relevant Event clause, works affected, mitigation,
--   a recap of events
-- - profiles: each user's job title (signature) — editable by the user
-- - the notice of delay wording, if not yet written, set to DBP's style
-- No existing data is lost.
-- =====================================================================

alter table jobs add column if not exists notice_clause text;        -- notice of delay, e.g. 2.24.1
alter table jobs add column if not exists eot_clause text;           -- fixing a later Completion Date, e.g. 2.25
alter table jobs add column if not exists le_clause text;            -- loss and expense, e.g. 4.19 and 4.20
alter table jobs add column if not exists client_contact_id uuid references contacts(id) on delete set null;

alter table delay_events add column if not exists clause text;      -- Relevant Event clause for this event (required for letters)
alter table delay_events add column if not exists area text;        -- works affected, e.g. "the ground floor"
alter table delay_events add column if not exists mitigation text;  -- what DBP has done to mitigate
alter table delay_events add column if not exists timeline text;    -- "A short recap of events", one per line

alter table profiles add column if not exists job_title text;       -- signature, e.g. Quantity Surveyor
grant update (full_name, initials, job_title) on profiles to authenticated;

-- the letter wording, with the clause placeholders
update text_templates set
  notes = 'DBP''s notice of delay (as The Mall Walthamstow, Aug 2025). Placeholders: {{notice_clause}}, {{event_clause}}, {{area}}, {{period}} (e.g. eight weeks), {{current_pc}}, {{new_pc}}, {{contract}}. Keep {{events}} on its own line: the app puts the numbered events there (title, narrative, mitigation, recap). Clause numbers come from the job''s EOT tab and each event; the letter won''t generate until they''re filled in.',
  body = case when coalesce(body, '') = '' then
'We write with reference to the above project and the recent discussions. Having reviewed our programme, we wish to record our formal notice of delay to our contracted works because of ongoing and relevant events, as required under clause {{notice_clause}} and as detailed below.

In accordance with clause {{notice_clause}} we anticipate the delay to the progress of our works{{area}} will extend the date of Practical Completion by {{period}} from our current agreed PC date of the {{current_pc}} to the {{new_pc}}.

The Relevant Events under clause {{event_clause}} that have caused delay to our programme, and which in our opinion justify an extension of time, are as follows:

{{events}}

The changes above have impacted on our programme, which will be revised and reissued. Once the full assessment of the delay is made we will provide further substantiation as required to justify in detail the impact on our programme, but we feel this provides adequate justification for an interim extension of time to be granted.

We are continuing to monitor the effect of these changes on the Date for Completion and will advise of any associated costs and/or loss and expense in due course.

As always, we will continue to use our best endeavours to mitigate all delays and costs associated with this notice.

Please do not hesitate to contact us if you have any queries or require any further information in relation to this notice of delay.'
  else body end
 where key = 'eot_notice_letter';
update text_templates set notes = 'Covering letter for an EOT claim. Placeholders: {{contract}}, {{notice_clause}}, {{completion_clause}}, {{le_clause}} (loss and expense), {{days}}, {{period}}, {{completion}}, {{revised_completion}}. The table of events with each Relevant Event clause is added by the app. Clause numbers come from the job''s EOT tab.'
 where key = 'eot_claim_letter';
