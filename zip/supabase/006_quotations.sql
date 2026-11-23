-- =====================================================================
-- 006 · Quotations: the extra details a quotation needs
-- Layout follows the 2611 waterproofing quotation (30.10.2026). 001
-- created quotations / quotation_lines / quotation_clauses. This adds:
-- - client name / contact / address, who prepared it, the site
-- - the opening line ("…our quotation of £X + VAT for <summary>…")
-- - scope as an intro paragraph plus sub-headed groups of numbered or
--   bulleted items; qualifications & exclusions as sub-headed bullets
-- - why the validity date is what it is (shown in section 04)
-- - appendices, whether the standard T&Cs are attached, internal notes
-- - a bold heading on each pricing line ("Waterproofing — Delta MS500…")
-- - an editable copy of each add-on clause on the quotation
-- No existing data is lost.
-- =====================================================================

alter table quotations add column if not exists client_name text;
alter table quotations add column if not exists client_contact text;
alter table quotations add column if not exists client_address text;
alter table quotations add column if not exists prepared_by text;
alter table quotations add column if not exists site text;
alter table quotations add column if not exists summary text;              -- "the waterproofing and associated builder's works"
alter table quotations add column if not exists scope_groups jsonb not null default '[]'::jsonb;         -- [{"heading","style":"numbered"|"bullets","items":[...]}]
alter table quotations add column if not exists qualification_groups jsonb not null default '[]'::jsonb; -- [{"heading","items":[...]}]
alter table quotations add column if not exists validity_note text;        -- "That date is set by the validity of the specialist's price."
alter table quotations add column if not exists vat_pct numeric(5,2) not null default 20;
alter table quotations add column if not exists appendices text;
alter table quotations add column if not exists include_terms boolean not null default true;
alter table quotations add column if not exists notes text;                -- internal only, never on the quotation

alter table quotation_lines add column if not exists heading text;         -- bold lead-in, e.g. "Waterproofing"

alter table quotation_clauses add column if not exists title text;
alter table quotation_clauses add column if not exists body text;
alter table quotation_clauses add column if not exists sort int not null default 0;
