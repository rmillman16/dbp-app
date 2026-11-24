-- =====================================================================
-- 088 · Email signature (24 Nov)
-- One du Boulay signature, kept in Settings › Email signature, goes at the foot
-- of every email that goes outside the company (the Outlook drafts and the
-- emails the app sends itself). HTML; {{person}} = the sender's name, title and
-- phone; {{logo}} = the DBP logo. Blank = the standard signature.
-- Admins change it (company_settings already allows that). Safe to run again.
-- =====================================================================
alter table company_settings add column if not exists email_signature text;
