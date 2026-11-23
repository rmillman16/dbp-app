-- =====================================================================
-- du Boulay Projects super app · database set-up (first version)
-- Paste into Supabase › SQL Editor › New query › Run. Safe to run once
-- on an empty project. Everything is in the "public" schema.
--
-- Access: small team, no roles yet. Anyone signed in can read and edit
-- everything; nobody else can see anything. profiles.is_admin exists so
-- admin-only actions (e.g. O&M document lists) can be locked later.
-- Bank details are deliberately not stored anywhere in this database.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- shared helpers ----------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- enums ----------
create type company_type      as enum ('client','subcontractor','supplier','consultant','designer','other');
create type job_status        as enum ('tender','live','complete','archived');
create type vo_status         as enum ('not_issued','issued','agreed','rejected');
create type vo_line_section   as enum ('omit','add');
create type quote_status      as enum ('draft','issued','accepted','rejected','withdrawn');
create type app_status        as enum ('draft','submitted','assessed','paid');
create type notice_status     as enum ('draft','issued');
create type delay_type        as enum ('variation','late_information','client_third_party');
create type eot_status        as enum ('draft','notified','claimed','granted','rejected');
create type proc_section      as enum ('contract','variation');
create type proc_status       as enum ('not_started','enquiry_out','quotes_in','recommended','ordered','on_site','complete','covered','nothing_to_order');
create type supply_install    as enum ('supply','install','supply_and_install');
create type sample_type       as enum ('sample','benchmark','mock_up');
create type sample_status     as enum ('not_requested','requested','submitted','approved','approved_with_comments','rejected_resubmit');
create type om_status         as enum ('not_requested','requested','received','accepted','rejected_resubmit','not_required');
create type report_status     as enum ('draft','approved','issued');
create type notif_severity    as enum ('overdue','due_soon','info');
create type notif_status      as enum ('open','done','snoozed');

-- =====================================================================
-- PEOPLE, COMPANY, CONTRACTORS
-- =====================================================================
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  initials    text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- new sign-ups get a profile row automatically
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- one row: company details used on every export (logo, letterhead). No bank details.
create table company_settings (
  id             int primary key default 1 check (id = 1),
  legal_name     text not null default 'du Boulay Projects Ltd',
  address        text,
  phone          text,
  email          text,
  website        text,
  logo_url       text,
  default_retention_pct numeric(5,2) not null default 5,
  default_ohp_pct       numeric(5,2) not null default 15,
  default_prelims_pct   numeric(5,2) not null default 9,
  updated_at     timestamptz not null default now()
);
insert into company_settings (id, address, phone, email, website)
values (1, 'Studio 7, Royal Victoria Patriotic Building, John Archer Way, London SW18 3SX',
        '020 8877 0266', 'office@duboulay.co.uk', 'duboulay.co.uk');

create table company_insurances (
  id              uuid primary key default gen_random_uuid(),
  cover           text not null,
  insurer         text,
  policy_no       text,
  limit_text      text,
  limit_amount    numeric(14,2),
  excess          numeric(14,2),
  start_date      date,
  end_date        date not null,
  certificate_url text,
  created_at      timestamptz not null default now()
);
insert into company_insurances (cover, insurer, policy_no, limit_text, limit_amount, excess, start_date, end_date) values
 ('Employers liability','Aviva Insurance Limited','100687754CSI','£10,000,000 each and every claim',10000000,null,'2026-07-01','2027-06-30'),
 ('Public liability','Aviva Insurance Limited','100687754CSI','£5,000,000 each and every claim',5000000,1000,'2026-07-01','2027-06-30'),
 ('Products liability','Aviva Insurance Limited','100687754CSI','£5,000,000 in the aggregate',5000000,null,'2026-07-01','2027-06-30'),
 ('Public and products liability (excess layer)','American International Group UK Limited','0032030785','£5,000,000 excess of £10,000,000',5000000,null,'2026-07-01','2027-06-30'),
 ('Contractors all risks','Aviva Insurance Limited','100687754CSI','£2,500,000 maximum any one contract',2500000,null,'2026-07-01','2027-06-30'),
 ('Professional indemnity','Hiscox Insurance Company Limited','PL-PSC10003452804','£5,000,000 each and every claim',5000000,10000,'2026-07-01','2027-06-30'),
 ('Hired-in plant','Aviva Insurance Limited','100687754CSI','£100,000',100000,null,'2026-07-01','2027-06-30');

create table companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          company_type not null default 'subcontractor',
  trade         text,
  address       text,
  postcode      text,
  email         text,
  phone         text,
  iplicit_code  text,                 -- supplier code in iPlicit (CVR cost import)
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on companies (lower(name));

create table contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  role        text,
  email       text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- JOBS
-- =====================================================================
create table jobs (
  id                    uuid primary key default gen_random_uuid(),
  job_no                int not null,              -- 2611
  code                  text not null,             -- FISL
  name                  text not null,             -- Micro by The Fix
  site_address          text,
  client_company_id     uuid references companies(id),
  status                job_status not null default 'live',
  contract_form         text,                      -- e.g. JCT D&B 2024
  contract_sum          numeric(14,2),
  start_date            date,
  pc_date               date,
  retention_pct         numeric(5,2) not null default 5,
  ohp_pct               numeric(5,2) not null default 15,
  prelims_pct           numeric(5,2) not null default 9,
  weekly_prelims        numeric(14,2),             -- EOT prolongation rate
  report_frequency_days int,                       -- progress report frequency
  sharepoint_site_url   text,                      -- the only per-job SharePoint setting
  timeline_programme_id text,                      -- link to Timeline once merged
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (job_no, code)
);

create table job_team (
  job_id      uuid references jobs(id) on delete cascade,
  profile_id  uuid references profiles(id) on delete cascade,
  role        text not null,                       -- PM, QS, site manager…
  primary key (job_id, profile_id, role)
);

-- client team / consultants per job (project directory)
create table job_directory (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  company_id  uuid references companies(id),
  contact_id  uuid references contacts(id),
  role        text not null,                       -- Architect, Client PM, Building Control…
  client_direct boolean not null default false
);

-- =====================================================================
-- SCHEDULE OF WORKS AND PACKAGES (office SoW drives packages, CVR, cashflow)
-- =====================================================================
create table sow_revisions (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  revision      text not null,                     -- R6
  kind          text not null check (kind in ('office','client')),
  source_url    text,
  imported_at   timestamptz not null default now(),
  is_current    boolean not null default true
);

create table packages (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  name            text not null,                   -- Joinery, Dry lining…
  sow_column      text,                            -- column it came from in the office SoW
  budget          numeric(14,2),
  supply_install  supply_install,
  cdp             boolean not null default false,
  sort            int not null default 0
);

create table sow_lines (
  id            uuid primary key default gen_random_uuid(),
  revision_id   uuid not null references sow_revisions(id) on delete cascade,
  section       text,
  item_ref      text,
  description   text,
  qty           numeric(14,3),
  unit          text,
  rate          numeric(14,2),
  total         numeric(14,2),
  ohp           numeric(14,2),
  package_costs jsonb,                             -- {"Joinery": 1234.5, …} from the office SoW columns
  timeline_task_refs text[],                       -- cashflow: section linked to programme tasks
  sort          int not null default 0
);

-- =====================================================================
-- VARIATIONS AND QUOTATIONS
-- =====================================================================
create table variations (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references jobs(id) on delete cascade,
  vo_no            int not null,
  title            text not null,
  description      text,
  status           vo_status not null default 'not_issued',
  budget_value     numeric(14,2),                  -- hidden on exports once a firm price exists
  ohp_pct          numeric(5,2),
  prelims_pct      numeric(5,2),
  programme_days   numeric(6,1) default 0,         -- feeds EOT delay events
  instruction_ref  text,                           -- CAI / AI number
  date_issued      date,
  date_agreed      date,
  sharepoint_folder_url text,                      -- 7. Variations / VO N - Name
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (job_id, vo_no)
);

create table variation_lines (
  id            uuid primary key default gen_random_uuid(),
  variation_id  uuid not null references variations(id) on delete cascade,
  section       vo_line_section not null default 'add',
  description   text not null,
  qty           numeric(14,3),
  unit          text,
  rate          numeric(14,2),
  total         numeric(14,2),
  package_id    uuid references packages(id),
  sort          int not null default 0
);

-- firm price = OMIT/ADD build-up with OHP and prelims; null until priced
create view variation_totals as
select v.id as variation_id, v.job_id, v.vo_no, v.status,
       coalesce(sum(case when l.section='add' then l.total else -l.total end),0) as net_lines,
       coalesce(sum(case when l.section='add' then l.total else -l.total end),0)
         * (1 + coalesce(v.ohp_pct, j.ohp_pct)/100) * (1 + coalesce(v.prelims_pct, j.prelims_pct)/100) as firm_value,
       count(l.id) > 0 as is_priced, v.budget_value
from variations v join jobs j on j.id = v.job_id
left join variation_lines l on l.variation_id = v.id
group by v.id, j.ohp_pct, j.prelims_pct;

create table tc_clauses (                           -- add-on clause library (to come)
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  category   text,
  approved   boolean not null default false,       -- legally reviewed
  created_at timestamptz not null default now()
);

create table quotations (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  variation_id    uuid references variations(id) on delete set null,
  quote_no        int not null,
  subject         text not null,                   -- "Waterproofing"
  ref             text generated always as ('QU' || lpad(quote_no::text, 3, '0') || ' – ' || subject) stored,
  status          quote_status not null default 'draft',
  scope           text,
  qualifications  text,
  issued_date     date,
  valid_until     date,
  accepted_date   date,
  accepted_by     text,
  sharepoint_url  text,                            -- VARIATIONS TO PRICE until accepted, then VO folder
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (job_id, quote_no)
);

-- full reference, e.g. "2611 FISL – QU001 – Waterproofing"
create view quotation_refs as
select q.id, j.job_no || ' ' || j.code || ' – ' || q.ref as full_ref
from quotations q join jobs j on j.id = q.job_id;

create table quotation_lines (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references quotations(id) on delete cascade,
  item          text,
  description   text not null,
  qty           numeric(14,3),
  unit          text,
  rate          numeric(14,2),                     -- OHP and prelims built in on the client copy
  total         numeric(14,2),
  sort          int not null default 0
);

create table quotation_clauses (
  quotation_id  uuid references quotations(id) on delete cascade,
  clause_id     uuid references tc_clauses(id),
  primary key (quotation_id, clause_id)
);

-- =====================================================================
-- CLIENT APPLICATIONS
-- =====================================================================
create table applications (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references jobs(id) on delete cascade,
  app_no           int not null,
  revision         int not null default 0,         -- R1, R2…
  status           app_status not null default 'draft',
  valuation_date   date,
  submitted_date   date,
  materials_on_site numeric(14,2) default 0,
  loss_and_expense numeric(14,2) default 0,
  deposit          numeric(14,2) default 0,
  retention_pct    numeric(5,2),
  previously_paid  numeric(14,2) default 0,
  client_certified numeric(14,2),                  -- Client assessment total
  paid_amount      numeric(14,2),
  paid_date        date,
  notes            text,
  created_at       timestamptz not null default now(),
  unique (job_id, app_no, revision)
);

create table application_lines (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications(id) on delete cascade,
  sow_line_id     uuid references sow_lines(id),
  variation_id    uuid references variations(id),
  pct_claimed     numeric(6,3),
  amount_claimed  numeric(14,2),
  client_pct      numeric(6,3),                    -- "Client Assessment", never the certifier's name
  client_amount   numeric(14,2),
  comment         text,
  check (sow_line_id is not null or variation_id is not null)
);

-- =====================================================================
-- SUBCONTRACT ORDERS, APPLICATIONS AND PAYMENT NOTICES
-- =====================================================================
create table orders (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  package_id      uuid references packages(id),
  company_id      uuid not null references companies(id),
  folder_no       int,                             -- 3. Orders / NN - Trade - Subcontractor
  order_no        text,                            -- 2611/FISL/02
  po_ref          text,                            -- POR000986
  order_value     numeric(14,2),
  order_date      date,
  retention_pct   numeric(5,2) not null default 5,
  sharepoint_folder_url text,
  created_at      timestamptz not null default now()
);

create table sub_variations (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  ref         text,
  description text,
  value       numeric(14,2),
  instructed  boolean not null default false,
  variation_id uuid references variations(id)      -- the client VO it relates to, if any
);

create table sub_applications (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  app_no        int not null,
  app_date      date,
  received_date date,
  source_url    text,                              -- their PDF / Excel
  stated_gross  numeric(14,2),
  stated_due    numeric(14,2),
  import_checks jsonb,                             -- findings from the import checks
  created_at    timestamptz not null default now(),
  unique (order_id, app_no)
);

create table sub_application_lines (
  id                  uuid primary key default gen_random_uuid(),
  sub_application_id  uuid not null references sub_applications(id) on delete cascade,
  block               text not null check (block in ('measured','materials','variations')),
  heading             text,
  item_ref            text,
  description         text,
  value               numeric(14,2),
  pct                 numeric(6,3),
  amount              numeric(14,2),
  their_amount        numeric(14,2),
  note                text,
  sort                int not null default 0
);

create table payment_notices (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  notice_no           int not null,
  sub_application_id  uuid references sub_applications(id),
  status              notice_status not null default 'draft',
  notice_date         date,
  valuation_date      date,
  payment_due_date    date,
  dbp_payment_date    date,
  measured_works      numeric(14,2) default 0,     -- DuB assessment
  variations          numeric(14,2) default 0,
  materials_on_site   numeric(14,2) default 0,
  loss_and_expense    numeric(14,2) default 0,
  contra_charges      numeric(14,2) default 0,
  retention_pct       numeric(5,2),
  previously_paid     numeric(14,2) default 0,
  oms_outstanding     boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (order_id, notice_no)
);

create table payment_notice_adjustments (           -- DuB assessment lines, e.g. prelims at 25% not 30%
  id                 uuid primary key default gen_random_uuid(),
  payment_notice_id  uuid not null references payment_notices(id) on delete cascade,
  description        text not null,
  amount             numeric(14,2) not null
);

-- =====================================================================
-- CASHFLOW
-- =====================================================================
create table cashflow_issues (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  issued_date date not null default current_date,
  client_copy jsonb,                               -- certified and paid only
  internal_copy jsonb,                             -- adds DBP applied figures
  file_url    text
);

-- =====================================================================
-- CVR
-- =====================================================================
create table cost_imports (                         -- iPlicit job costing report, monthly
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  period_end  date not null,
  source_url  text,
  imported_at timestamptz not null default now()
);

create table cost_lines (
  id              uuid primary key default gen_random_uuid(),
  import_id       uuid not null references cost_imports(id) on delete cascade,
  supplier_code   text,
  supplier_name   text,
  committed       numeric(14,2),
  invoiced        numeric(14,2),
  unposted        numeric(14,2),
  provisions      numeric(14,2),
  total_cost      numeric(14,2),
  last_reported   numeric(14,2),
  paid_to_date    numeric(14,2),
  retention       numeric(14,2)
);

create table cvrs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  period_end  date not null,
  cost_import_id uuid references cost_imports(id),
  summary     jsonb,                               -- final account projected, gross margin, weeks delay…
  file_url    text,
  created_at  timestamptz not null default now(),
  unique (job_id, period_end)
);

create table cvr_vo_allocations (                   -- VO costs allocated to packages inside the CVR
  cvr_id        uuid references cvrs(id) on delete cascade,
  variation_id  uuid references variations(id) on delete cascade,
  package_id    uuid references packages(id),
  cost          numeric(14,2) not null,
  primary key (cvr_id, variation_id, package_id)
);

-- =====================================================================
-- EOT
-- =====================================================================
create table delay_events (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  type          delay_type not null,
  variation_id  uuid references variations(id),     -- auto-created from VO programme days
  description   text not null,
  event_date    date,
  days_claimed  numeric(6,1),
  notice_due    date,                              -- from the contract's notice period
  notice_sent   date,
  status        eot_status not null default 'draft',
  created_at    timestamptz not null default now()
);

create table eot_claims (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  claim_no        int not null,
  submitted_date  date,
  days_claimed    numeric(6,1),
  days_granted    numeric(6,1),
  weekly_prelims  numeric(14,2),
  status          eot_status not null default 'draft',
  file_url        text,
  unique (job_id, claim_no)
);

create table eot_claim_events (
  claim_id  uuid references eot_claims(id) on delete cascade,
  event_id  uuid references delay_events(id) on delete cascade,
  primary key (claim_id, event_id)
);

-- =====================================================================
-- PROCUREMENT SCHEDULE
-- =====================================================================
create table procurement_items (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references jobs(id) on delete cascade,
  section            proc_section not null default 'contract',
  package_id         uuid references packages(id),
  variation_id       uuid references variations(id),
  ref                text,
  description        text not null,
  supply_install     supply_install,
  cdp                boolean not null default false,
  budget             numeric(14,2),                -- internal only
  design_weeks       numeric(5,1) default 0,
  lead_weeks         numeric(5,1) default 0,
  required_on_site   date,                         -- from Timeline (or programme import until merged)
  timeline_task_refs text[],
  latest_order_date  date generated always as
                       (required_on_site - ((coalesce(lead_weeks,0) + coalesce(design_weeks,0)) * 7)::int) stored,
  status             proc_status not null default 'not_started',
  order_id           uuid references orders(id),   -- appointed subcontractor + order value
  comments           text,
  sort               int not null default 0
);

-- =====================================================================
-- SAMPLING TRACKER
-- =====================================================================
create table finish_schedules (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs(id) on delete cascade,
  designer     text,
  document_no  text,
  revision     text,
  source_url   text,
  imported_at  timestamptz not null default now()
);

create table samples (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references jobs(id) on delete cascade,
  finish_schedule_id    uuid references finish_schedules(id),
  code                  text not null,             -- M-S102
  designer_ref          text,                      -- SFF17
  material_group        text not null,             -- Fabrics, Stone, ceramic and composite…
  locations             text[],                    -- one row even if used on several levels
  description           text,
  specification         text,
  supplier_company_id   uuid references companies(id),
  sample_type           sample_type not null default 'sample',
  requested_date        date,
  due_date              date,
  submitted_date        date,
  status                sample_status not null default 'not_requested',
  designer_comments     text,
  decided_by            text,
  decision_date         date,
  approval_evidence_url text,                      -- email or signed label
  stored_location       text,
  photo_url             text,
  changed_after_approval boolean not null default false,
  sort                  int not null default 0,
  unique (job_id, code)
);

-- =====================================================================
-- O&M AND H&S FILE
-- =====================================================================
create table om_doc_types (                         -- standard list by trade; admin adds project items
  id        uuid primary key default gen_random_uuid(),
  trade     text not null,
  name      text not null,
  standard  boolean not null default true,
  job_id    uuid references jobs(id) on delete cascade   -- set for project-specific items
);

create table om_requirements (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references jobs(id) on delete cascade,
  order_id       uuid references orders(id),        -- DBP subcontractor
  company_id     uuid references companies(id),     -- client direct contractor
  doc_type_id    uuid references om_doc_types(id),
  custom_name    text,
  status         om_status not null default 'not_requested',
  requested_date date,
  due_date       date,                             -- default 4 weeks before PC
  received_date  date,
  file_url       text,
  reviewer_comment text,
  check (doc_type_id is not null or custom_name is not null)
);

-- =====================================================================
-- PROGRESS REPORTS
-- =====================================================================
create table progress_reports (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  report_no     int not null,
  period_start  date,
  period_end    date,
  status        report_status not null default 'draft',
  sections      jsonb,                             -- numbered sections, switched on / off per job
  appendices    jsonb,                             -- ordered list, auto + added by PM
  word_url      text,
  pdf_url       text,
  approved_by   uuid references profiles(id),
  created_at    timestamptz not null default now(),
  unique (job_id, report_no)
);

-- =====================================================================
-- NOTIFICATIONS (bell on the front page)
-- =====================================================================
create table notifications (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references profiles(id) on delete cascade,  -- null = everyone
  job_id        uuid references jobs(id) on delete cascade,
  kind          text not null,                     -- insurance_expiry, order_by, sample_due, om_due, payment_notice, eot_notice, car_limit…
  title         text not null,
  detail        text,
  due_date      date,
  link          text,
  source_table  text,
  source_id     uuid,
  status        notif_status not null default 'open',
  snoozed_until date,
  created_at    timestamptz not null default now()
);
create index on notifications (status, due_date);

-- live severity, so red / amber is always current
create view notifications_live as
select n.*,
  case when n.due_date is null then 'info'::notif_severity
       when n.due_date < current_date then 'overdue'::notif_severity
       when n.due_date <= current_date + 14 then 'due_soon'::notif_severity
       else 'info'::notif_severity end as severity
from notifications n
where n.status = 'open' or (n.status = 'snoozed' and n.snoozed_until <= current_date);

-- insurance reminders at 60, 30 and 7 days before each cover ends
insert into notifications (kind, title, detail, due_date, source_table, source_id)
select 'insurance_expiry', ci.cover || ' renews ' || to_char(ci.end_date, 'DD Mon YYYY'),
       ci.insurer || ' · ' || coalesce(ci.policy_no,'') || ' · upload the new certificate',
       ci.end_date - d, 'company_insurances', ci.id
from company_insurances ci cross join (values (60),(30),(7)) as r(d);

-- flag any job over the contractors all risks limit when it's added or its contract sum changes
create or replace function public.flag_car_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare car numeric;
begin
  select limit_amount into car from company_insurances
   where cover = 'Contractors all risks' and end_date >= current_date order by end_date desc limit 1;
  if car is not null and new.contract_sum > car then
    insert into notifications (job_id, kind, title, detail, due_date, source_table, source_id)
    values (new.id, 'car_limit',
            new.job_no || ' ' || new.code || ' is over the £' || to_char(car,'FM9,999,999') || ' CAR limit',
            'Contract sum £' || to_char(new.contract_sum,'FM999,999,999') || ': extend cover before starting',
            current_date, 'jobs', new.id);
  end if;
  return new;
end $$;
create trigger jobs_car_limit after insert or update of contract_sum on jobs
  for each row execute function public.flag_car_limit();

-- =====================================================================
-- updated_at triggers
-- =====================================================================
create trigger t_companies_upd  before update on companies  for each row execute function set_updated_at();
create trigger t_jobs_upd       before update on jobs       for each row execute function set_updated_at();
create trigger t_variations_upd before update on variations for each row execute function set_updated_at();
create trigger t_quotations_upd before update on quotations for each row execute function set_updated_at();

-- =====================================================================
-- SECURITY: row level security on every table; signed-in users only
-- =====================================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "signed-in users" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- views run with the permissions of the person asking, so RLS still applies
alter view variation_totals   set (security_invoker = true);
alter view notifications_live set (security_invoker = true);
alter view quotation_refs     set (security_invoker = true);
