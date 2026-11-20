-- =====================================================================
-- 016 · CVR package groups and preliminaries sections
-- Agreed with Richard 20 Nov:
-- - packages are grouped (Labour & materials, Subcontractors,
--   Preliminaries, Other) and listed alphabetically within each group
-- - the office SoW's prelims headings (Project & commercial management,
--   Site management & multi services team, Consumables…) become
--   packages under Preliminaries. They draw down the SoW's single
--   prelims budget, kept as "Preliminaries – not yet split", until a
--   section's own budget is typed.
-- No existing data is lost.
-- =====================================================================

alter table packages add column if not exists cvr_group text;   -- blank = worked out from the name
alter table packages drop constraint if exists packages_cvr_group_check;
alter table packages add constraint packages_cvr_group_check check (cvr_group is null or cvr_group in ('labour_materials', 'subcontract', 'prelims', 'other'));
alter table packages add column if not exists is_remainder boolean not null default false;  -- the prelims lump the sections draw down
