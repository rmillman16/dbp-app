-- =====================================================================
-- 032 · Site: material requisitions (hire to follow)
-- Agreed with Richard 22 Nov (docs/decisions.md "Material and hire
-- requisition forms"). Replaces the SharePoint "dbp Material Requisitions"
-- list (start fresh). One list across all jobs for the buyer; the form is
-- its own link for site managers; the buyer asks the requester questions
-- on each requisition, which go on the requester's bell and the job's To do.
-- - requisitions (kind: material now, hire later), their conversation and
--   attachments (private storage area "requisitions")
-- - reminders addressed to one person (notifications.profile_id) are shown
--   only to them; everyone else's stay shown to everyone, as before
-- Who sees the buyer's list is locked down later (operations user type).
-- No existing data is lost.
-- =====================================================================

create table if not exists requisitions (
  id                  uuid primary key default gen_random_uuid(),
  req_no              bigint generated always as identity,          -- MR0001…
  kind                text not null default 'material' check (kind in ('material', 'hire')),
  job_id              uuid not null references jobs(id) on delete cascade,  -- "Site name"
  element             text not null,                                -- "Element of work", e.g. partitioning
  details             text not null,                                -- "Materials required" (with links)
  required_by         date not null,                                -- "Date required by"
  notes               text,                                         -- booking systems, time restrictions…
  status              text not null default 'new' check (status in ('new', 'query', 'answered', 'ordered', 'delivered', 'cancelled')),
  requested_by        uuid references profiles(id) default auth.uid(),
  requester_name      text,
  requester_email     text,
  buyer_id            uuid references profiles(id),                 -- who's dealing with it
  supplier_company_id uuid references companies(id),
  po_number           text,
  order_value         numeric(12,2),
  order_date          date,
  delivery_date       date,
  data                jsonb not null default '{}'::jsonb,           -- a hire requisition's own fields (later)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists requisitions_job on requisitions (job_id);
create index if not exists requisitions_status on requisitions (status, required_by);
drop trigger if exists t_requisitions_upd on requisitions;
create trigger t_requisitions_upd before update on requisitions for each row execute function set_updated_at();

-- the conversation: the buyer's questions, the requester's answers, notes
create table if not exists requisition_messages (
  id              uuid primary key default gen_random_uuid(),
  requisition_id  uuid not null references requisitions(id) on delete cascade,
  author_id       uuid references profiles(id) default auth.uid(),
  author_name     text,
  body            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists requisition_messages_req on requisition_messages (requisition_id, created_at);

create table if not exists requisition_files (
  id              uuid primary key default gen_random_uuid(),
  requisition_id  uuid not null references requisitions(id) on delete cascade,
  path            text not null,                                    -- in storage "requisitions"
  name            text not null,
  uploaded_by     uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now()
);

alter table requisitions enable row level security;
alter table requisition_messages enable row level security;
alter table requisition_files enable row level security;
drop policy if exists "signed-in users" on requisitions;
drop policy if exists "signed-in users" on requisition_messages;
drop policy if exists "signed-in users" on requisition_files;
create policy "signed-in users" on requisitions for all to authenticated using (true) with check (true);
create policy "signed-in users" on requisition_messages for all to authenticated using (true) with check (true);
create policy "signed-in users" on requisition_files for all to authenticated using (true) with check (true);
grant select, insert, update, delete on requisitions, requisition_messages, requisition_files to authenticated;

-- attachments (private: signed-in users only)
insert into storage.buckets (id, name, public) values ('requisitions', 'requisitions', false) on conflict (id) do nothing;
drop policy if exists "requisitions: signed-in read" on storage.objects;
drop policy if exists "requisitions: signed-in add" on storage.objects;
drop policy if exists "requisitions: signed-in remove" on storage.objects;
create policy "requisitions: signed-in read" on storage.objects for select to authenticated using (bucket_id = 'requisitions');
create policy "requisitions: signed-in add" on storage.objects for insert to authenticated with check (bucket_id = 'requisitions');
create policy "requisitions: signed-in remove" on storage.objects for delete to authenticated using (bucket_id = 'requisitions');

-- reminders addressed to one person go only to them (none are addressed yet, so nothing changes for existing ones)
create or replace view notifications_live with (security_invoker = true) as
select n.*,
  case when n.due_date is null then 'info'::notif_severity
       when n.due_date < current_date then 'overdue'::notif_severity
       when n.due_date <= current_date + (case when n.kind = 'valuation_due' then 7 else 14 end) then 'due_soon'::notif_severity
       else 'info'::notif_severity end as severity
from notifications n
where (n.status = 'open' or (n.status = 'snoozed' and n.snoozed_until <= current_date))
  and (n.profile_id is null or n.profile_id = auth.uid());

-- a message on a requisition:
-- - from anyone but the requester (the buyer): a question. The requisition goes to "query" and the requester
--   gets a reminder (dated when it's needed by), on the bell and the job's To do
-- - from the requester: an answer. Their question reminders close, it goes to "answered", and whoever asked
--   last gets a reminder
create or replace function public.requisition_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r requisitions;
  j jobs;
  ref text;
  asker uuid;
begin
  select * into r from requisitions where id = new.requisition_id;
  select * into j from jobs where id = r.job_id;
  ref := case r.kind when 'hire' then 'HR' else 'MR' end || lpad(r.req_no::text, 4, '0');
  if new.author_id is distinct from r.requested_by then
    update requisitions set status = 'query', buyer_id = coalesce(buyer_id, new.author_id) where id = r.id and status in ('new', 'answered', 'query');
    if r.requested_by is not null then
      insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (r.requested_by, r.job_id, 'requisition_query',
              coalesce(j.job_no || ' ' || j.code || ' ', '') || ref || ': question on ' || r.element,
              left(new.body, 300), r.required_by, '/site/requisitions/' || r.id, 'requisitions', r.id);
    end if;
  else
    update notifications set status = 'done'
     where source_table = 'requisitions' and source_id = r.id and kind = 'requisition_query' and profile_id = r.requested_by and status <> 'done';
    update requisitions set status = 'answered' where id = r.id and status = 'query';
    select author_id into asker from requisition_messages
     where requisition_id = r.id and author_id is distinct from r.requested_by order by created_at desc limit 1;
    if asker is not null then
      insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (asker, r.job_id, 'requisition_answer',
              coalesce(j.job_no || ' ' || j.code || ' ', '') || ref || ': answered (' || r.element || ')',
              left(new.body, 300), r.required_by, '/site/requisitions/' || r.id, 'requisitions', r.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists requisition_message on requisition_messages;
create trigger requisition_message after insert on requisition_messages for each row execute function public.requisition_message();

-- ordered / delivered / cancelled: the requester hears (no date: it's news, not a task); the buyer's answer
-- reminders close once it's dealt with
create or replace function public.requisition_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
  ref text;
begin
  if new.status = old.status then return new; end if;
  select * into j from jobs where id = new.job_id;
  ref := case new.kind when 'hire' then 'HR' else 'MR' end || lpad(new.req_no::text, 4, '0');
  if new.status in ('ordered', 'delivered', 'cancelled') then
    update notifications set status = 'done'
     where source_table = 'requisitions' and source_id = new.id and kind in ('requisition_answer', 'requisition_query') and status <> 'done';
    if new.requested_by is not null then
      insert into notifications (profile_id, job_id, kind, title, detail, link, source_table, source_id)
      values (new.requested_by, new.job_id, 'requisition_update',
              coalesce(j.job_no || ' ' || j.code || ' ', '') || ref || ' ' || new.status || ': ' || new.element,
              case when new.status = 'ordered' and new.delivery_date is not null then 'Delivery ' || to_char(new.delivery_date, 'DD/MM/YYYY') else null end,
              '/site/requisitions/' || new.id, 'requisitions', new.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists requisition_status on requisitions;
create trigger requisition_status after update of status on requisitions for each row execute function public.requisition_status();
