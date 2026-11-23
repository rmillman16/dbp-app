-- =====================================================================
-- 056 · Subcontract variations: instruct them and file what goes with them (23 Nov)
-- On an order, a variation can be instructed from the app: a variation
-- instruction letter (Word) and an Outlook draft to the subcontractor with
-- their quote / emails attached. Everything attached is filed in a folder
-- for that variation inside the order's own folder (storage "orders":
-- order/<order id>/variations/<ref>/...).
-- - sub_variations: when instructed, when the email was made
-- - sub_variation_files: the files filed under a variation, with a type
--   (quote, email, instruction, other)
-- - follows the order's access (Orders needs "Job › commercial") and an
--   archived job is read-only
-- Safe to run more than once. No existing data is lost (run after 055).
-- =====================================================================
alter table sub_variations add column if not exists instructed_on date;
alter table sub_variations add column if not exists instruction_emailed_at timestamptz;

create table if not exists sub_variation_files (
  id           uuid primary key default gen_random_uuid(),
  variation_id uuid not null references sub_variations(id) on delete cascade,
  kind         text not null default 'other' check (kind in ('quote', 'email', 'instruction', 'other')),
  name         text not null,
  path         text not null,
  file_name    text not null,
  uploaded_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists sub_variation_files_var on sub_variation_files (variation_id);
alter table sub_variation_files enable row level security;
grant select, insert, update, delete on sub_variation_files to authenticated;
drop policy if exists "order access" on sub_variation_files;
create policy "order access" on sub_variation_files for all to authenticated
  using (public.has_access('job_commercial')) with check (public.has_access('job_commercial'));
drop policy if exists "archived job: no changes" on sub_variation_files;
create policy "archived job: no changes" on sub_variation_files as restrictive for all to authenticated
  using (true)
  with check (not exists (select 1 from sub_variations v join orders o on o.id = v.order_id where v.id = variation_id and public.job_archived(o.job_id)));
