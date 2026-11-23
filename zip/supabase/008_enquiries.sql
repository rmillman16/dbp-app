-- =====================================================================
-- 008 · Estimating: enquiries
-- Estimating is laid out like Jobs: a list of enquiries (small works,
-- new enquiries, tenders), each with its own quotations. When one is
-- won it is set up as a job and its quotations move into the job.
-- - enquiries: E001, E002… with name, site, client contact details,
--   dates, status (enquiry / pricing / submitted / won / lost)
-- - quotations.enquiry_id: which enquiry a quotation belongs to
-- - quotations are numbered per enquiry (E001 – QU001, QU002…), like jobs
-- No existing data is lost.
-- =====================================================================

create table if not exists enquiries (
  id              uuid primary key default gen_random_uuid(),
  enquiry_no      int not null unique,
  name            text not null,
  site_address    text,
  client_name     text,
  client_contact  text,
  client_email    text,
  client_phone    text,
  received_date   date default current_date,
  due_date        date,                              -- tender / quote return date
  status          text not null default 'enquiry' check (status in ('enquiry','pricing','submitted','won','lost')),
  estimator       text,
  notes           text,
  job_id          uuid references jobs(id) on delete set null,   -- set when won and set up as a job
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists t_enquiries_upd on enquiries;
create trigger t_enquiries_upd before update on enquiries for each row execute function set_updated_at();
alter table enquiries enable row level security;
drop policy if exists "signed-in users" on enquiries;
create policy "signed-in users" on enquiries for all to authenticated using (true) with check (true);

alter table quotations add column if not exists enquiry_id uuid references enquiries(id) on delete set null;

-- estimating quotations are numbered per enquiry (replaces the single EST series from 007)
drop index if exists quotations_estimating_no;
create unique index if not exists quotations_enquiry_no on quotations (enquiry_id, quote_no) where job_id is null;
