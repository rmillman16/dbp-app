-- =====================================================================
-- 067 - Tender enquiries and the tender tracker (Estimating)
-- The Enquiry Generator, rebuilt inside the app: for an Estimating enquiry, a PACKAGE
-- (a trade) is sent out to a list of contractors, one email each (an Outlook draft).
-- The tracker follows each contractor on each package, like Procurement does:
-- drafted > sent > interested / declined > quote received > appointed / unsuccessful,
-- with chasing and the quote value.
-- Safe to run more than once. No existing data is touched.
-- =====================================================================

create table if not exists tender_packages (
  id             uuid primary key default gen_random_uuid(),
  enquiry_id     uuid not null references enquiries(id) on delete cascade,
  package        text not null,                       -- the trade / package, e.g. "Mechanical and electrical"
  return_date    date not null,                       -- tenders back by
  job_address    text,
  main_contract  text,
  sub_contract   text,
  summary        text,                                -- project summary
  scope          text,                                -- what this package covers
  notes          text,                                -- tender notes
  documents_link text,                                -- SharePoint / OneDrive link to the drawings
  sender_name    text,
  sender_phone   text,
  email_subject  text,
  email_body     text,
  created_by     uuid references profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists tender_packages_enquiry on tender_packages (enquiry_id);

create table if not exists tender_invites (
  id              uuid primary key default gen_random_uuid(),
  package_id      uuid not null references tender_packages(id) on delete cascade,
  company_id      uuid references companies(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  name            text not null,                      -- company name (kept if the company is later removed)
  email           text,
  status          text not null default 'drafted'
                  check (status in ('drafted', 'sent', 'interested', 'declined', 'quoted', 'appointed', 'unsuccessful')),
  sent_on         date,
  chased_count    int  not null default 0,
  last_chased_on  date,
  quote_amount    numeric(14,2),
  quote_received_on date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tender_invites_package on tender_invites (package_id);
create unique index if not exists tender_invites_once on tender_invites (package_id, company_id) where company_id is not null;
drop trigger if exists t_tender_invites_upd on tender_invites;
create trigger t_tender_invites_upd before update on tender_invites for each row execute function set_updated_at();

alter table tender_packages enable row level security;
alter table tender_invites enable row level security;
grant select, insert, update, delete on tender_packages to authenticated;
grant select, insert, update, delete on tender_invites to authenticated;
drop policy if exists "signed-in users" on tender_packages;
create policy "signed-in users" on tender_packages for all to authenticated using (true) with check (true);
drop policy if exists "signed-in users" on tender_invites;
create policy "signed-in users" on tender_invites for all to authenticated using (true) with check (true);
