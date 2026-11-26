-- =====================================================================
-- 101 · Variations: tell the project team when one is agreed, let a variation be deleted, site team can list them (26 Nov)
-- Run after 100. Safe to run again.
-- =====================================================================

-- 1. When a variation becomes Agreed, everyone on the job's team (du Boulay staff only, not External logins) gets a bell notification
create or replace function public.variation_agreed_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jobs;
begin
  if new.status = 'agreed' and (tg_op = 'INSERT' or old.status is distinct from 'agreed') then
    select * into j from jobs where id = new.job_id;
    insert into notifications (profile_id, job_id, kind, title, detail, link, source_table, source_id)
    select distinct t.profile_id, new.job_id, 'variation_agreed',
           j.job_no || ' ' || j.code || ' VO ' || new.vo_no || ' agreed: ' || new.title,
           'This variation has been agreed.',
           '/jobs/' || new.job_id || '/variations/' || new.id, 'variations', new.id
      from job_team t
      join profiles p on p.id = t.profile_id
     where t.job_id = new.job_id
       and not ('external' = any (p.roles))
       and t.profile_id is distinct from auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists variation_agreed_notify on variations;
create trigger variation_agreed_notify after insert or update of status on variations
  for each row execute function public.variation_agreed_notify();

-- 2. Deleting a variation: its lines go with it; anything that merely points at it (application lines, sub-contract variations,
--    procurement items, EOT events, RFIs, quotations) is kept and just loses the link. A draft EOT event raised from it goes too.
create or replace function public.variation_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from delay_events de
   where de.variation_id = old.id and de.status = 'draft'
     and not exists (select 1 from eot_claim_events ce where ce.event_id = de.id);
  delete from notifications where source_table = 'variations' and source_id = old.id;
  return old;
end $$;
drop trigger if exists variation_before_delete on variations;
create trigger variation_before_delete before delete on variations
  for each row execute function public.variation_before_delete();

alter table application_lines drop constraint if exists application_lines_variation_id_fkey;
alter table application_lines add constraint application_lines_variation_id_fkey foreign key (variation_id) references variations(id) on delete set null;
alter table sub_variations drop constraint if exists sub_variations_variation_id_fkey;
alter table sub_variations add constraint sub_variations_variation_id_fkey foreign key (variation_id) references variations(id) on delete set null;
alter table delay_events drop constraint if exists delay_events_variation_id_fkey;
alter table delay_events add constraint delay_events_variation_id_fkey foreign key (variation_id) references variations(id) on delete set null;
alter table procurement_items drop constraint if exists procurement_items_variation_id_fkey;
alter table procurement_items add constraint procurement_items_variation_id_fkey foreign key (variation_id) references variations(id) on delete set null;

-- 3. Site management can see the list of variations and their status (no values): a separate access part, ticked for them
insert into role_access (role, section) values ('site_management', 'job_variations_list') on conflict do nothing;

notify pgrst, 'reload schema';
