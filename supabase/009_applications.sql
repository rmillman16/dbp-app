-- =====================================================================
-- 009 · Client applications: priced SoW import and application details
-- Layout follows 2611 Application 2 R2 (30.10.2026). 001 created
-- sow_revisions / sow_lines / applications / application_lines; this adds:
-- - SoW lines: section headings vs priced items, text in place of a
--   figure (FOC, Excl, incl below, Client Direct), below-the-line items
-- - applications: provisional sum adjustment, practical completion,
--   VAT rate, which SoW revision it's priced against, less deposits
-- - application lines: Client Assessment comment
-- No existing data is lost.
-- =====================================================================

alter table sow_revisions add column if not exists file_name text;
alter table sow_revisions add column if not exists total numeric(14,2);

alter table sow_lines add column if not exists kind text not null default 'item' check (kind in ('section', 'item'));
alter table sow_lines add column if not exists total_text text;            -- FOC, Excl, incl below, Client Direct…
alter table sow_lines add column if not exists below_line boolean not null default false;

alter table applications add column if not exists sow_revision_id uuid references sow_revisions(id);
alter table applications add column if not exists psum_adjustment numeric(14,2) not null default 0;
alter table applications add column if not exists practical_completion boolean not null default false;
alter table applications add column if not exists vat_pct numeric(5,2) not null default 20;

alter table application_lines add column if not exists client_comment text;
create index if not exists application_lines_app on application_lines (application_id);
create index if not exists sow_lines_rev on sow_lines (revision_id, sort);
