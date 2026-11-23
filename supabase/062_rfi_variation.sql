-- =====================================================================
-- 062 · RFI to variation (23 Nov)
-- Richard: an RFI whose answer changes the scope should become a variation. A variation can be raised from an RFI (Job ›
-- RFIs › the RFI › "Raise a variation"): it is made as a draft VO carrying the question and the answer, and the two are
-- linked, so the RFI shows its VO and the VO shows the RFI it came from.
-- Safe to run more than once. No existing data is lost (run after 061).
-- =====================================================================
alter table rfis add column if not exists variation_id uuid references variations(id) on delete set null;
create index if not exists rfis_variation on rfis (variation_id) where variation_id is not null;
