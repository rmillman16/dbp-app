-- =====================================================================
-- 057 · RFIs (23 Nov): the register, templates, replies, files, chasing
-- Agreed with Richard 23 Nov (docs/decisions.md "RFIs, submittals and external access"):
-- - RFIs per job, numbered 1, 2, 3… per job (no job code). Title, question (formatted text), status
--   (open / answered / closed / void), trade (the spec section), RFI manager (DBP), due date, received from
--   (someone in the job's project directory), assignees and Cc (people in the directory, or DBP's team),
--   attachments, email notifications on / off, chase frequency per RFI
-- - templates (Settings): preset people by role (looked up in each job's directory / team), title, question,
--   due days, chase frequency, for common ones (joinery, electrical, mechanical…)
-- - replies and files kept per RFI; DBP's RFI manager closes it
-- - a new part of the app in Settings › Access, "Job › RFIs & submittals". Starting ticks: Project manager,
--   Commercial, Site management, Design
-- - chasing: rfi_chase_tick() (run by the send-emails function every couple of minutes) puts a chase on the RFI
--   manager's bell (and email) and on DBP assignees', and queues one for each outside assignee in rfi_outbox
--   (sent when outside access is live). A weekly list of each manager's unanswered RFIs is emailed on Mondays
-- - an archived job's RFIs are read-only, like everything else on it (042)
-- Safe to run more than once. No existing data is lost (run after 056).
-- =====================================================================

-- ---------- who can open it (Settings › Access) ----------
insert into role_access (role, section) values
  ('project_manager', 'job_rfis'), ('commercial', 'job_rfis'), ('site_management', 'job_rfis'), ('design', 'job_rfis')
on conflict do nothing;

-- ---------- trades (the spec section list) ----------
create table if not exists rfi_trades (
  name text primary key,
  sort int not null default 0
);
insert into rfi_trades (name, sort) values
  ('Architectural', 10), ('Structural', 20), ('Mechanical', 30), ('Electrical', 40), ('Public health', 50), ('Joinery', 60),
  ('Dry lining', 70), ('Flooring', 80), ('Decorating', 90), ('Metalwork', 100), ('Fire protection', 110), ('Groundworks', 120),
  ('Preliminaries', 130), ('General', 140)
on conflict do nothing;
alter table rfi_trades enable row level security;
grant select, insert, delete on rfi_trades to authenticated;
drop policy if exists "signed-in users" on rfi_trades;
create policy "signed-in users" on rfi_trades for all to authenticated using (true) with check (true);

-- ---------- templates ----------
create table if not exists rfi_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  trade           text,
  manager_role    text,                              -- a job team role, e.g. PM
  assignee_roles  text[] not null default '{}',      -- roles in the job's project directory, e.g. Joinery subcontractor
  cc_roles        text[] not null default '{}',      -- roles in the directory or on the job team
  title_prefix    text,
  question        text,
  due_days        int,                               -- working days
  chase_days      int not null default 7,            -- 0 = no chasing
  archived        boolean not null default false,
  sort            int not null default 0,
  created_at      timestamptz not null default now()
);
alter table rfi_templates enable row level security;
grant select, insert, update, delete on rfi_templates to authenticated;
drop policy if exists "signed-in users" on rfi_templates;
create policy "signed-in users" on rfi_templates for select to authenticated using (true);
drop policy if exists "templates: change" on rfi_templates;
create policy "templates: change" on rfi_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());
insert into rfi_templates (name, trade, manager_role, assignee_roles, cc_roles, title_prefix, question, due_days, chase_days, sort)
select * from (values
  ('Joinery technical RFI', 'Joinery', 'PM', array['Joinery subcontractor'], array['Designer', 'Site manager'], 'Joinery: ', 'Please confirm the following for the joinery package: ', 5, 7, 10),
  ('Electrical technical RFI', 'Electrical', 'PM', array['Electrical subcontractor'], array['Designer', 'Site manager'], 'Electrical: ', 'Please confirm the following for the electrical package: ', 5, 7, 20),
  ('Mechanical technical RFI', 'Mechanical', 'PM', array['Mechanical subcontractor'], array['Designer', 'Site manager'], 'Mechanical: ', 'Please confirm the following for the mechanical package: ', 5, 7, 30),
  ('Architect design query', 'Architectural', 'PM', array['Architect'], array['Designer'], null, null, 5, 7, 40)
) as v(name, trade, manager_role, assignee_roles, cc_roles, title_prefix, question, due_days, chase_days, sort)
where not exists (select 1 from rfi_templates);

-- ---------- RFIs ----------
create table if not exists rfis (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references jobs(id) on delete cascade,
  number         int not null,
  title          text not null,
  question       text,                               -- formatted text (HTML the app cleans)
  status         text not null default 'open' check (status in ('open', 'answered', 'closed', 'void')),
  trade          text,
  manager_id     uuid references profiles(id) on delete set null,
  due_date       date,
  received_from  uuid references job_directory(id) on delete set null,
  notify         boolean not null default true,      -- email notifications
  chase_days     int not null default 7,             -- 0 = never chased
  last_chased_at timestamptz,
  template_id    uuid references rfi_templates(id) on delete set null,
  created_by     uuid references profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  answered_at    timestamptz,
  closed_at      timestamptz,
  unique (job_id, number)
);
create index if not exists rfis_job on rfis (job_id, number);
create index if not exists rfis_open on rfis (status) where status in ('open', 'answered');

-- numbered 1, 2, 3 per job when no number is given
create or replace function public.rfi_number() returns trigger
language plpgsql as $$
begin
  if new.number is null or new.number <= 0 then
    select coalesce(max(number), 0) + 1 into new.number from rfis where job_id = new.job_id;
  end if;
  return new;
end $$;
drop trigger if exists rfi_number on rfis;
create trigger rfi_number before insert on rfis for each row execute function public.rfi_number();
alter table rfis alter column number drop not null;
alter table rfis alter column number set default 0;

-- answered / closed dates follow the status
create or replace function public.rfi_status_dates() returns trigger
language plpgsql as $$
begin
  if new.status = 'answered' and (tg_op = 'INSERT' or old.status is distinct from 'answered') then new.answered_at := now(); end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status is distinct from 'closed') then new.closed_at := now(); end if;
  if new.status in ('open') then new.closed_at := null; end if;
  return new;
end $$;
drop trigger if exists rfi_status_dates on rfis;
create trigger rfi_status_dates before insert or update on rfis for each row execute function public.rfi_status_dates();

-- ---------- people on an RFI ----------
create table if not exists rfi_people (
  id           uuid primary key default gen_random_uuid(),
  rfi_id       uuid not null references rfis(id) on delete cascade,
  role         text not null check (role in ('assignee', 'cc')),
  directory_id uuid references job_directory(id) on delete cascade,   -- an outside person in the job's directory
  profile_id   uuid references profiles(id) on delete cascade,        -- or someone in DBP
  check ((directory_id is not null) <> (profile_id is not null))
);
create index if not exists rfi_people_rfi on rfi_people (rfi_id);

-- ---------- replies and files ----------
create table if not exists rfi_responses (
  id          uuid primary key default gen_random_uuid(),
  rfi_id      uuid not null references rfis(id) on delete cascade,
  kind        text not null default 'reply' check (kind in ('reply', 'follow_up', 'note')),
  body        text,
  author_id   uuid references profiles(id) on delete set null default auth.uid(),   -- DBP; null = an outside person
  author_name text,                                                                  -- as shown (an outside person's name)
  created_at  timestamptz not null default now()
);
create index if not exists rfi_responses_rfi on rfi_responses (rfi_id, created_at);

create table if not exists rfi_files (
  id          uuid primary key default gen_random_uuid(),
  rfi_id      uuid not null references rfis(id) on delete cascade,
  response_id uuid references rfi_responses(id) on delete cascade,        -- null = attached to the RFI itself
  name        text not null,
  path        text not null,                                              -- in storage "rfis": <rfi id>/<time>-<file>
  file_name   text not null,
  uploaded_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists rfi_files_rfi on rfi_files (rfi_id);

-- emails waiting for the outside-access / email set-up: one per person per new RFI / chase
create table if not exists rfi_outbox (
  id         uuid primary key default gen_random_uuid(),
  rfi_id     uuid not null references rfis(id) on delete cascade,
  person_id  uuid not null references rfi_people(id) on delete cascade,
  kind       text not null check (kind in ('new', 'chase')),
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists rfi_outbox_waiting on rfi_outbox (created_at) where sent_at is null;

create table if not exists rfi_report_log (
  week_start date primary key,
  sent_at    timestamptz not null default now()
);

-- ---------- access and archived jobs ----------
do $$
declare t text;
begin
  foreach t in array array['rfis', 'rfi_people', 'rfi_responses', 'rfi_files', 'rfi_outbox'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop policy if exists "access grid" on %I', t);
    execute format('create policy "access grid" on %I as restrictive for all to authenticated using (public.has_access(''job_rfis'')) with check (public.has_access(''job_rfis''))', t);
    execute format('drop policy if exists "signed-in users" on %I', t);
    execute format('create policy "signed-in users" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
alter table rfi_report_log enable row level security;   -- no policies: only the email function (server key) reads it

drop policy if exists "archived job: no changes" on rfis;
create policy "archived job: no changes" on rfis as restrictive for all to authenticated
  using (true) with check (not public.job_archived(job_id));
do $$
declare t text;
begin
  foreach t in array array['rfi_people', 'rfi_responses', 'rfi_files', 'rfi_outbox'] loop
    execute format('drop policy if exists "archived job: no changes" on %I', t);
    execute format('create policy "archived job: no changes" on %I as restrictive for all to authenticated using (true) with check (not exists (select 1 from rfis r where r.id = rfi_id and public.job_archived(r.job_id)))', t);
  end loop;
end $$;

-- ---------- files (private storage area "rfis") ----------
insert into storage.buckets (id, name, public) values ('rfis', 'rfis', false) on conflict (id) do nothing;
drop policy if exists "rfis: read" on storage.objects;
drop policy if exists "rfis: add" on storage.objects;
drop policy if exists "rfis: remove" on storage.objects;
create policy "rfis: read" on storage.objects for select to authenticated
  using (bucket_id = 'rfis' and public.has_access('job_rfis'));
create policy "rfis: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'rfis' and public.has_access('job_rfis'));
create policy "rfis: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'rfis' and public.has_access('job_rfis') and (owner = auth.uid() or public.is_admin()));

-- ---------- the bell: a new RFI, a reply, a chase ----------
create or replace function public.rfi_new_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jobs;
begin
  select * into j from jobs where id = new.job_id;
  if new.manager_id is not null and new.manager_id is distinct from new.created_by then
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (new.manager_id, new.job_id, 'rfi_new', j.job_no || ' ' || j.code || ' RFI ' || new.number || ': ' || new.title,
            'You are the RFI manager.', new.due_date, '/jobs/' || new.job_id || '/rfis/' || new.id, 'rfis', new.id);
  end if;
  return new;
end $$;
drop trigger if exists rfi_new_notify on rfis;
create trigger rfi_new_notify after insert on rfis for each row execute function public.rfi_new_notify();

-- a DBP person added as an assignee / Cc is told
create or replace function public.rfi_person_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r rfis; j jobs;
begin
  if new.profile_id is null then return new; end if;
  select * into r from rfis where id = new.rfi_id;
  if new.profile_id is not distinct from r.created_by or new.profile_id is not distinct from r.manager_id then return new; end if;
  select * into j from jobs where id = r.job_id;
  insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
  values (new.profile_id, r.job_id, 'rfi_new', j.job_no || ' ' || j.code || ' RFI ' || r.number || ': ' || r.title,
          case new.role when 'assignee' then 'Assigned to you.' else 'You are copied in.' end, r.due_date, '/jobs/' || r.job_id || '/rfis/' || r.id, 'rfis', r.id);
  -- an outside assignee's "new RFI" email waits in the outbox
  return new;
end $$;
drop trigger if exists rfi_person_notify on rfi_people;
create trigger rfi_person_notify after insert on rfi_people for each row execute function public.rfi_person_notify();

create or replace function public.rfi_outbox_new() returns trigger
language plpgsql security definer set search_path = public as $$
declare r rfis;
begin
  select * into r from rfis where id = new.rfi_id;
  if new.directory_id is not null and new.role = 'assignee' and r.notify then
    insert into rfi_outbox (rfi_id, person_id, kind) values (new.rfi_id, new.id, 'new');
  end if;
  return new;
end $$;
drop trigger if exists rfi_outbox_new on rfi_people;
create trigger rfi_outbox_new after insert on rfi_people for each row execute function public.rfi_outbox_new();

-- a reply from anyone but the manager goes to the manager's bell; the RFI moves to "answered"
create or replace function public.rfi_reply_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r rfis; j jobs;
begin
  select * into r from rfis where id = new.rfi_id;
  if new.kind = 'reply' and r.status = 'open' and new.author_id is distinct from r.manager_id then
    update rfis set status = 'answered' where id = r.id;
  end if;
  if r.manager_id is not null and new.author_id is distinct from r.manager_id and new.kind <> 'note' then
    select * into j from jobs where id = r.job_id;
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (r.manager_id, r.job_id, 'rfi_answered', j.job_no || ' ' || j.code || ' RFI ' || r.number || ' has a reply: ' || r.title,
            coalesce(new.author_name, 'Someone') || ' replied. Review it, then close the RFI.', null, '/jobs/' || r.job_id || '/rfis/' || r.id, 'rfis', r.id);
  end if;
  return new;
end $$;
drop trigger if exists rfi_reply_notify on rfi_responses;
create trigger rfi_reply_notify after insert on rfi_responses for each row execute function public.rfi_reply_notify();

-- a closed or void RFI closes its reminders
create or replace function public.rfi_done_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('closed', 'void') and old.status is distinct from new.status then
    update notifications set status = 'done', auto_closed = true
     where source_table = 'rfis' and source_id = new.id and kind in ('rfi_new', 'rfi_answered', 'rfi_chase') and status <> 'done';
  end if;
  return new;
end $$;
drop trigger if exists rfi_done_notify on rfis;
create trigger rfi_done_notify after update of status on rfis for each row execute function public.rfi_done_notify();

-- ---------- chasing ----------
-- Called every couple of minutes by the send-emails function (server key). For each RFI still unanswered whose chase
-- is due (every chase_days since it was made or last chased): the RFI manager and DBP assignees get a chase on the
-- bell, and each outside assignee gets one queued in rfi_outbox. Returns how many RFIs were chased.
create or replace function public.rfi_chase_tick() returns int
language plpgsql security definer set search_path = public as $$
declare r rfis; j jobs; p record; n int := 0; hit uuid; t text; d text;
begin
  for r in
    select * from rfis
     where status = 'open' and chase_days > 0 and notify
       and current_date - coalesce(last_chased_at, created_at)::date >= chase_days
  loop
    select * into j from jobs where id = r.job_id;
    if j.status = 'archived' then continue; end if;
    t := j.job_no || ' ' || j.code || ' RFI ' || r.number || ' still unanswered: ' || r.title;
    d := case when r.due_date is null then 'No due date.' when r.due_date < current_date then 'Overdue: was due ' || to_char(r.due_date, 'DD/MM/YYYY') || '.' else 'Due ' || to_char(r.due_date, 'DD/MM/YYYY') || '.' end;
    for p in
      select r.manager_id as pid where r.manager_id is not null
      union select profile_id from rfi_people where rfi_id = r.id and role = 'assignee' and profile_id is not null
    loop
      hit := null;
      select id into hit from notifications where kind = 'rfi_chase' and source_id = r.id and profile_id = p.pid and status <> 'done' limit 1;
      if hit is not null then
        update notifications set title = t, detail = d, due_date = r.due_date, created_at = now(), emailed_at = null where id = hit;
      else
        insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
        values (p.pid, r.job_id, 'rfi_chase', t, d, r.due_date, '/jobs/' || r.job_id || '/rfis/' || r.id, 'rfis', r.id);
      end if;
    end loop;
    insert into rfi_outbox (rfi_id, person_id, kind)
      select r.id, id, 'chase' from rfi_people where rfi_id = r.id and role = 'assignee' and directory_id is not null;
    update rfis set last_chased_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.rfi_chase_tick() from public, anon, authenticated;
grant execute on function public.rfi_chase_tick() to service_role;
