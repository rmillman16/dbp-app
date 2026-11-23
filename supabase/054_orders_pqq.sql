-- =====================================================================
-- 054 · Orders (was Payment notices) and contractors' PQQs (23 Nov)
-- Agreed with Richard 23 Nov:
-- Orders
-- - order numbers 2611_FISL_001 (job no, code, three-figure count per job)
-- - each order is for a package from the procurement schedule (the SoW's
--   packages, or one added by hand), with a delivery / start date: the
--   schedule's required on site, else the programme's first activity for
--   that trade. Draft until placed
-- - placing an order fills in the procurement schedule: subcontractor,
--   order value, number, date, status Ordered (whoever places it, even
--   without Procurement access)
-- - appendices on each order, any file type (storage "orders"), picked from
--   a standard library kept in Settings (e.g. payment / application dates)
--   or added for that order only
-- Contractors and PQQs
-- - PQQ status per company: not sent, sent, received, approved, rejected,
--   not required. Approved lasts 12 months. The standard PQQ pack lives in
--   the same library (kind 'pqq') and goes with an order to anyone not
--   approved
-- - a log of what was sent to whom and when (PQQ packs and orders)
-- - their documents (insurances, accreditations, returned PQQ) with expiry
--   dates, stored in "orders" under company/<id>/
-- - reminders to DBP staff to chase, on the bell (and email, once email is
--   set up): PQQ sent 14 days and not back; PQQ back, to review; PQQ
--   expiring (30 days before); a document expiring (30 days before). They go
--   to the company's "PQQ chased by" person, else the admins, and show on
--   their day, not before
-- Payment notices
-- - each line of their application certified by DBP, by % or £ (the other
--   follows): cert_pct, cert_amount. Blank = as claimed
-- Safe to run more than once. No existing data is lost; existing orders
-- count as placed.
-- =====================================================================

-- ---------- orders ----------
alter table orders add column if not exists package_name  text;          -- the procurement package (its SoW name)
alter table orders add column if not exists scope         text;          -- printed on the order
alter table orders add column if not exists delivery_date date;          -- delivery / start on site
alter table orders add column if not exists delivery_from text;          -- where it came from: procurement / programme / typed
alter table orders add column if not exists contact_id    uuid references contacts(id) on delete set null;
alter table orders add column if not exists status        text not null default 'placed';
alter table orders add column if not exists placed_on     date;
alter table orders add column if not exists placed_by     uuid references profiles(id) on delete set null;
alter table orders add column if not exists emailed_at    timestamptz;   -- the email draft last made
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in ('draft', 'placed'));
update orders set placed_on = coalesce(order_date, created_at::date) where status = 'placed' and placed_on is null;

-- placing an order fills in the procurement schedule (the package's row, made if it isn't there yet)
create or replace function public.order_placed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'placed' and new.package_name is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'placed' or old.order_value is distinct from new.order_value
          or old.company_id is distinct from new.company_id or old.order_no is distinct from new.order_no
          or old.package_name is distinct from new.package_name) then
    insert into procurement_items (job_id, section, description, company_id, order_id, order_value, order_no, order_date, status)
    values (new.job_id, 'contract', new.package_name, new.company_id, new.id, new.order_value, new.order_no,
            coalesce(new.placed_on, current_date), 'ordered')
    on conflict (job_id, description) where section = 'contract' do update
      set company_id = excluded.company_id, order_id = excluded.order_id, order_value = excluded.order_value,
          order_no = excluded.order_no, order_date = excluded.order_date,
          status = case when procurement_items.status in ('on_site', 'complete') then procurement_items.status else 'ordered'::proc_status end;
  end if;
  return new;
end $$;
drop trigger if exists order_placed on orders;
create trigger order_placed after insert or update on orders for each row execute function public.order_placed();

-- ---------- the standard library: appendices and the PQQ pack (Settings) ----------
create table if not exists standard_documents (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('appendix', 'pqq')),
  name        text not null,                     -- "Appendix: payment and application dates"
  description text,
  path        text not null,                     -- in storage "orders": library/<time>-<file>
  file_name   text not null,
  default_on  boolean not null default true,     -- ticked on every new order
  archived    boolean not null default false,    -- removed from the library; orders that used it keep it
  sort        int not null default 0,
  uploaded_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table standard_documents enable row level security;
grant select, insert, update, delete on standard_documents to authenticated;
drop policy if exists "signed-in users" on standard_documents;
create policy "signed-in users" on standard_documents for select to authenticated using (true);
drop policy if exists "library: change" on standard_documents;
create policy "library: change" on standard_documents for all to authenticated
  using (public.is_admin() or public.has_access('job_commercial')) with check (public.is_admin() or public.has_access('job_commercial'));

-- ---------- appendices on an order ----------
create table if not exists order_appendices (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  standard_id uuid references standard_documents(id) on delete set null,
  name        text not null,
  path        text not null,                     -- the library's file, or order/<order id>/<time>-<file>
  file_name   text not null,
  sort        int not null default 0,
  uploaded_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists order_appendices_order on order_appendices (order_id, sort);
alter table order_appendices enable row level security;
grant select, insert, update, delete on order_appendices to authenticated;
drop policy if exists "signed-in users" on order_appendices;
create policy "signed-in users" on order_appendices for all to authenticated
  using (public.has_access('job_commercial')) with check (public.has_access('job_commercial'));
drop policy if exists "archived job: no changes" on order_appendices;
create policy "archived job: no changes" on order_appendices as restrictive for all to authenticated
  using (true)
  with check (not exists (select 1 from orders o where o.id = order_id and public.job_archived(o.job_id)));

-- ---------- PQQ per company ----------
alter table companies add column if not exists pqq_status      text not null default 'not_sent';
alter table companies add column if not exists pqq_sent_on     date;
alter table companies add column if not exists pqq_received_on date;
alter table companies add column if not exists pqq_approved_on date;
alter table companies add column if not exists pqq_expires_on  date;      -- approved + 12 months
alter table companies add column if not exists pqq_owner       uuid references profiles(id) on delete set null; -- who chases
alter table companies add column if not exists pqq_notes       text;
alter table companies drop constraint if exists companies_pqq_status_check;
alter table companies add constraint companies_pqq_status_check
  check (pqq_status in ('not_sent', 'sent', 'received', 'approved', 'rejected', 'not_required'));

-- the dates follow the status: sent / received / approved today if not given; approved lasts 12 months
create or replace function public.company_pqq_dates() returns trigger
language plpgsql as $$
begin
  if new.pqq_status = 'sent' and new.pqq_sent_on is null then new.pqq_sent_on := current_date; end if;
  if new.pqq_status = 'received' and new.pqq_received_on is null then new.pqq_received_on := current_date; end if;
  if new.pqq_status = 'approved' then
    if new.pqq_approved_on is null then new.pqq_approved_on := current_date; end if;
    if new.pqq_expires_on is null or (tg_op = 'UPDATE' and old.pqq_approved_on is distinct from new.pqq_approved_on) then
      new.pqq_expires_on := (new.pqq_approved_on + interval '12 months')::date;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists company_pqq_dates on companies;
create trigger company_pqq_dates before insert or update on companies for each row execute function public.company_pqq_dates();

-- their documents, with expiry dates
create table if not exists company_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  kind        text not null default 'other'
              check (kind in ('pqq_return', 'insurance_el', 'insurance_pl', 'insurance_car', 'insurance_pi', 'accreditation', 'health_safety', 'other')),
  name        text not null,
  expires_on  date,
  path        text,                               -- in storage "orders": company/<company id>/<time>-<file>
  file_name   text,
  uploaded_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists company_documents_company on company_documents (company_id);
alter table company_documents enable row level security;
grant select, insert, update, delete on company_documents to authenticated;
drop policy if exists "signed-in users" on company_documents;
create policy "signed-in users" on company_documents for all to authenticated using (true) with check (true);

-- what was sent to whom and when
create table if not exists pqq_log (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  order_id   uuid references orders(id) on delete set null,
  via        text not null default 'pqq' check (via in ('pqq', 'order', 'reminder')),
  sent_to    text,                                -- the email address(es)
  documents  text[] not null default '{}',        -- what went
  note       text,
  sent_by    uuid references profiles(id) on delete set null default auth.uid(),
  sent_at    timestamptz not null default now()
);
create index if not exists pqq_log_company on pqq_log (company_id, sent_at desc);
alter table pqq_log enable row level security;
grant select, insert, delete on pqq_log to authenticated;
drop policy if exists "signed-in users" on pqq_log;
create policy "signed-in users" on pqq_log for all to authenticated using (true) with check (true);

-- ---------- files (private: through the app only) ----------
insert into storage.buckets (id, name, public) values ('orders', 'orders', false) on conflict (id) do nothing;
drop policy if exists "orders: read" on storage.objects;
drop policy if exists "orders: add" on storage.objects;
drop policy if exists "orders: remove" on storage.objects;
create policy "orders: read" on storage.objects for select to authenticated
  using (bucket_id = 'orders' and ((storage.foldername(name))[1] <> 'order' or public.has_access('job_commercial')));
create policy "orders: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'orders' and (
    (storage.foldername(name))[1] = 'company'
    or ((storage.foldername(name))[1] in ('library', 'order') and (public.is_admin() or public.has_access('job_commercial')))));
create policy "orders: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'orders' and (owner = auth.uid() or public.is_admin()));

-- ---------- PQQ reminders ----------
create or replace function public.pqq_chasers(p_company uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select pqq_owner from companies where id = p_company and pqq_owner is not null
  union
  select id from profiles where is_admin and not exists (select 1 from companies where id = p_company and pqq_owner is not null)
$$;

-- one reminder (kind, thing, person): updated in place, made if missing; returns its id
create or replace function public.pqq_remind(p_kind text, p_table text, p_source uuid, p_person uuid, p_title text, p_detail text, p_due date, p_link text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hit uuid;
begin
  select id into hit from notifications
   where kind = p_kind and source_id = p_source and profile_id = p_person and (status <> 'done' or auto_closed)
   order by (status <> 'done') desc, created_at desc limit 1;
  if hit is not null then
    update notifications set title = p_title, detail = p_detail, due_date = p_due, link = p_link, auto_closed = false,
           status = case when status = 'done' then 'open'::notif_status else status end
     where id = hit;
  elsif not exists (select 1 from notifications where kind = p_kind and source_id = p_source and profile_id = p_person and due_date = p_due) then
    insert into notifications (profile_id, kind, title, detail, due_date, link, source_table, source_id)
    values (p_person, p_kind, p_title, p_detail, p_due, p_link, p_table, p_source) returning id into hit;
  end if;
  return hit;
end $$;

create or replace function public.refresh_pqq_reminders(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c companies;
  d company_documents;
  p uuid;
  hit uuid;
  keep uuid[] := '{}';
  link text;
begin
  select * into c from companies where id = p_company;
  if c.id is null then return; end if;
  link := '/contractors?company=' || c.id;
  for p in select * from public.pqq_chasers(c.id) loop
    hit := null;
    if c.pqq_status = 'sent' and c.pqq_sent_on is not null then
      hit := public.pqq_remind('pqq_chase', 'companies', c.id, p, 'Chase PQQ: ' || c.name,
        'PQQ sent ' || to_char(c.pqq_sent_on, 'DD/MM/YYYY') || ' and not back yet.', c.pqq_sent_on + 14, link);
    elsif c.pqq_status = 'received' then
      hit := public.pqq_remind('pqq_review', 'companies', c.id, p, 'Review PQQ: ' || c.name,
        'Their PQQ came back ' || coalesce(to_char(c.pqq_received_on, 'DD/MM/YYYY'), '') || ': approve or reject it.', coalesce(c.pqq_received_on, current_date) + 3, link);
    elsif c.pqq_status = 'approved' and c.pqq_expires_on is not null then
      hit := public.pqq_remind('pqq_expiry', 'companies', c.id, p, 'PQQ expiring: ' || c.name,
        'Approved PQQ runs out ' || to_char(c.pqq_expires_on, 'DD/MM/YYYY') || ': send them a new PQQ.', c.pqq_expires_on - 30, link);
    end if;
    if hit is not null then keep := keep || hit; end if;
    for d in select * from company_documents where company_id = c.id and expires_on is not null loop
      hit := public.pqq_remind('company_doc_expiry', 'company_documents', d.id, p, c.name || ': ' || d.name || ' expiring',
        'Expires ' || to_char(d.expires_on, 'DD/MM/YYYY') || ': ask them for the renewed one.', d.expires_on - 30, link);
      if hit is not null then keep := keep || hit; end if;
    end loop;
  end loop;
  -- anything no longer needed (status moved on, document removed or re-dated, chaser changed) closes
  update notifications set status = 'done', auto_closed = true
   where status <> 'done' and not (id = any(keep))
     and ((kind in ('pqq_chase', 'pqq_review', 'pqq_expiry') and source_id = c.id)
       or (kind = 'company_doc_expiry' and (source_id in (select id from company_documents where company_id = c.id)
                                            or not exists (select 1 from company_documents x where x.id = source_id))));
end $$;

create or replace function public.pqq_reminders_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'companies' then
    perform public.refresh_pqq_reminders(coalesce(new.id, old.id));
  else
    perform public.refresh_pqq_reminders(coalesce(new.company_id, old.company_id));
    if tg_op = 'UPDATE' and old.company_id is distinct from new.company_id then perform public.refresh_pqq_reminders(old.company_id); end if;
  end if;
  return null;
end $$;
drop trigger if exists pqq_reminders on companies;
create trigger pqq_reminders after insert or update of pqq_status, pqq_sent_on, pqq_received_on, pqq_expires_on, pqq_owner, name on companies
  for each row execute function public.pqq_reminders_changed();
drop trigger if exists pqq_doc_reminders on company_documents;
create trigger pqq_doc_reminders after insert or update or delete on company_documents
  for each row execute function public.pqq_reminders_changed();

-- the bell: these show on their day, not before (like task reminders), and count as due that day
create or replace view notifications_live with (security_invoker = true) as
select n.id, n.profile_id, n.job_id, n.kind, n.title, n.detail, n.due_date, n.link, n.source_table, n.source_id, n.status, n.snoozed_until, n.created_at,
  case when n.due_date is null then 'info'::notif_severity
       when n.due_date < current_date then 'overdue'::notif_severity
       when n.due_date <= current_date + (case
            when n.kind = 'valuation_due' then 7
            when n.kind in ('off_hire_due', 'task_reminder', 'pqq_chase', 'pqq_review', 'pqq_expiry', 'company_doc_expiry') then 0
            else 14 end) then 'due_soon'::notif_severity
       else 'info'::notif_severity end as severity
from notifications n
where (n.status = 'open' or (n.status = 'snoozed' and n.snoozed_until <= current_date))
  and (n.profile_id is null or n.profile_id = auth.uid())
  and not (n.kind in ('task_reminder', 'pqq_chase', 'pqq_review', 'pqq_expiry', 'company_doc_expiry') and n.due_date > current_date);
grant select on notifications_live to authenticated;

-- ---------- payment notices: DBP certifies each line by % or £ ----------
alter table sub_application_lines add column if not exists cert_pct    numeric(7,4);   -- 0.4 = 40%
alter table sub_application_lines add column if not exists cert_amount numeric(14,2);
