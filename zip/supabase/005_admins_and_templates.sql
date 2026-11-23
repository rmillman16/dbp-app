-- =====================================================================
-- 005 · Admins and the Templates area
-- - is_admin(): true for logins marked admin in profiles.
-- - Richard is made the first admin. Nobody can make themselves admin
--   from the app: is_admin can only be changed here in the SQL Editor.
-- - Template tables (company details and default rates, insurances,
--   clause library, O&M document lists, wording templates): everyone
--   signed in can read them, only admins can change them.
-- - New table text_templates for wording (main T&Cs, letters).
-- - Insurance reminders (60 / 30 / 7 days) are rebuilt automatically
--   whenever a cover is added or its dates change.
-- No existing data is lost. The last query lists every login and
-- whether it is an admin, as a check.
-- =====================================================================

-- ---------- who is an admin ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;
grant execute on function public.is_admin() to authenticated;

update profiles set is_admin = true where lower(email) = 'richardmillman@duboulay.co.uk';

-- profiles: everyone can see the list; you can only change your own name / initials
drop policy if exists "signed-in users" on profiles;
create policy "read profiles" on profiles for select to authenticated using (true);
create policy "edit own profile" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on profiles from authenticated;
grant update (full_name, initials) on profiles to authenticated;

-- ---------- wording templates ----------
create table if not exists text_templates (
  key         text primary key,                    -- terms_main, eot_notice_letter…
  title       text not null,
  category    text,
  body        text not null default '',
  notes       text,                                -- guidance shown to the admin
  sort        int not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id)
);
drop trigger if exists t_text_templates_upd on text_templates;
create trigger t_text_templates_upd before update on text_templates for each row execute function set_updated_at();
alter table text_templates enable row level security;

insert into text_templates (key, title, category, sort, notes) values
 ('terms_main', 'Standard terms and conditions', 'Quotations', 10,
  'Attached to every quotation. The only draft found (Dec 2022) was written for du Boulay Contracts Limited and has open notes (D&B / CDP definitions, payment dates, notice periods, insurance limits). Finish it and have it legally reviewed before use.'),
 ('quotation_acceptance', 'Quotation: validity and acceptance wording', 'Quotations', 20,
  'Section 04 of every quotation, above the sign-off box (name, company, position, signature, date; or accept by email).'),
 ('eot_notice_letter', 'Notice of delay letter', 'EOT', 30,
  'Sent on letterhead when a delay event occurs. Notice periods and wording must follow each job''s contract (e.g. JCT D&B 2024).')
on conflict (key) do nothing;

-- ---------- template tables: read for everyone, change for admins ----------
do $$
declare t text;
begin
  foreach t in array array['company_settings','company_insurances','tc_clauses','om_doc_types','text_templates'] loop
    execute format('drop policy if exists "signed-in users" on public.%I', t);
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('drop policy if exists "admins change" on public.%I', t);
    execute format('create policy "read" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "admins change" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ---------- insurance reminders follow the cover's dates ----------
create or replace function public.insurance_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- clear this cover's reminders that haven't been dealt with
  delete from notifications
   where source_table = 'company_insurances' and kind = 'insurance_expiry' and status <> 'done'
     and source_id = case when tg_op = 'DELETE' then old.id else new.id end;
  if tg_op = 'DELETE' then return old; end if;

  insert into notifications (kind, title, detail, due_date, source_table, source_id)
  select 'insurance_expiry', new.cover || ' renews ' || to_char(new.end_date, 'DD Mon YYYY'),
         coalesce(new.insurer, '') || ' · ' || coalesce(new.policy_no, '') || ' · upload the new certificate',
         new.end_date - d, 'company_insurances', new.id
  from (values (60), (30), (7)) as r(d);
  return new;
end $$;

drop trigger if exists insurance_reminders on company_insurances;
create trigger insurance_reminders after insert or update of end_date, cover, insurer, policy_no or delete on company_insurances
  for each row execute function public.insurance_reminders();

-- ---------- check ----------
select email, is_admin from profiles order by email;
