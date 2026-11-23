-- =====================================================================
-- 038 · Requisitions: supplier as typed text (22 Nov)
-- Richard: "supplier needs to not be a dropdown, just a text box".
-- - requisitions.supplier: the supplier as the buyer types it
-- - any supplier already picked from the contractor list is copied across
-- No existing data is lost (the old link stays, unused).
-- =====================================================================

alter table requisitions add column if not exists supplier text;
update requisitions r set supplier = c.name
  from companies c
 where c.id = r.supplier_company_id and r.supplier is null;
