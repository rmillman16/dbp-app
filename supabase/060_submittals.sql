-- =====================================================================
-- 060 · Submittals (23 Nov), built on what RFIs taught us (057-059)
-- A submittal is something a subcontractor / supplier submits for approval (shop drawings, product data, samples, method
-- statements, certificates). DBP checks it and passes it to the reviewers (architect, client, consultants); they respond;
-- if it must be revised it is resubmitted as the next revision.
-- - per job, numbered 1, 2, 3; title, description, type, trade (spec section), who it was submitted by (a person in the
--   job's project directory), reviewers and Cc (directory or DBP team), DBP's manager, return-by date, required-on-site date
-- - revisions (A, B, C…): each keeps what was submitted, when, the response (Approved / Approved as noted / Revise and
--   resubmit / Rejected), the reviewer's notes and the files
-- - status: draft, out for review, then the response (approved, approved as noted, revise, rejected) or void
-- - chasing per submittal (as RFIs): while out for review, the manager and DBP reviewers are chased on the bell and by
--   email, outside reviewers' chasers queue in submittal_outbox; the Monday email also lists each manager's submittals
--   still out for review
-- - templates per project: who a joinery shop drawing is submitted by / reviewed by on this job
-- - access follows "Job › RFIs & submittals" (script 057); an archived job is read-only
-- Safe to run more than once. No existing data is lost (run after 059).
-- =====================================================================

create table if not exists submittals (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references jobs(id) on delete cascade,
  number         int not null default 0,
  title          text not null,
  description    text,                                 -- formatted text (HTML the app cleans)
  type           text not null default 'shop_drawing'
                 check (type in ('shop_drawing', 'product_data', 'sample', 'method_statement', 'certificate', 'other')),
  trade          text,
  status         text not null default 'draft'
                 check (status in ('draft', 'out', 'approved', 'approved_noted', 'revise', 'rejected', 'void')),
  current_rev    int not null default 1,               -- 1 = Rev A
  submitted_by   uuid references job_directory(id) on delete set null,   -- the subcontractor / supplier
  manager_id     uuid references profiles(id) on delete set null,
  due_date       date,                                 -- return by
  required_by    date,                                 -- needed on site
  notify         boolean not null default true,
  chase_days     int not null default 7,               -- 0 = never chased
  last_chased_at timestamptz,
  template_id    uuid,
  created_by     uuid references profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  responded_at   timestamptz,
  unique (job_id, number)
);
create index if not exists submittals_job on submittals (job_id, number);
create index if not exists submittals_out on submittals (status) where status = 'out';

create or replace function public.submittal_number() returns trigger
language plpgsql as $$
begin
  if new.number is null or new.number <= 0 then
    select coalesce(max(number), 0) + 1 into new.number from submittals where job_id = new.job_id;
  end if;
  return new;
end $$;
drop trigger if exists submittal_number on submittals;
create trigger submittal_number before insert on submittals for each row execute function public.submittal_number();

create or replace function public.submittal_status_dates() returns trigger
language plpgsql as $$
begin
  if new.status = 'out' and (tg_op = 'INSERT' or old.status is distinct from 'out') then new.submitted_at := now(); new.responded_at := null; end if;
  if new.status in ('approved', 'approved_noted', 'revise', 'rejected') and (tg_op = 'INSERT' or old.status is distinct from new.status) then new.responded_at := now(); end if;
  return new;
end $$;
drop trigger if exists submittal_status_dates on submittals;
create trigger submittal_status_dates before insert or update on submittals for each row execute function public.submittal_status_dates();

-- ---------- reviewers and Cc ----------
create table if not exists submittal_people (
  id            uuid primary key default gen_random_uuid(),
  submittal_id  uuid not null references submittals(id) on delete cascade,
  role          text not null check (role in ('reviewer', 'cc')),
  directory_id  uuid references job_directory(id) on delete cascade,
  profile_id    uuid references profiles(id) on delete cascade,
  check ((directory_id is not null) <> (profile_id is not null))
);
create index if not exists submittal_people_s on submittal_people (submittal_id);

-- ---------- revisions: what was submitted and how it was answered ----------
create table if not exists submittal_revisions (
  id              uuid primary key default gen_random_uuid(),
  submittal_id    uuid not null references submittals(id) on delete cascade,
  rev             int not null,                        -- 1 = A
  submitted_on    date,
  due_date        date,
  outcome         text check (outcome in ('approved', 'approved_noted', 'revise', 'rejected')),
  response_notes  text,
  responded_by    text,                                -- as shown: a reviewer's name
  responded_on    date,
  created_by      uuid references profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (submittal_id, rev)
);
create table if not exists submittal_files (
  id           uuid primary key default gen_random_uuid(),
  submittal_id uuid not null references submittals(id) on delete cascade,
  revision_id  uuid references submittal_revisions(id) on delete cascade,
  kind         text not null default 'submission' check (kind in ('submission', 'response')),
  name         text not null,
  path         text not null,                          -- in storage "submittals": <submittal id>/<time>-<file>
  file_name    text not null,
  uploaded_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists submittal_files_s on submittal_files (submittal_id);
create table if not exists submittal_outbox (
  id           uuid primary key default gen_random_uuid(),
  submittal_id uuid not null references submittals(id) on delete cascade,
  person_id    uuid not null references submittal_people(id) on delete cascade,
  kind         text not null check (kind in ('new', 'chase')),
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

-- ---------- templates per project ----------
create table if not exists submittal_templates (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references jobs(id) on delete cascade,
  name           text not null,
  type           text not null default 'shop_drawing',
  trade          text,
  submitter_key  text,                                 -- "d:<directory id>"
  reviewer_keys  text[] not null default '{}',         -- "d:<directory id>" or "p:<profile id>"
  cc_keys        text[] not null default '{}',
  manager_id     uuid references profiles(id) on delete set null,
  title_prefix   text,
  due_days       int,
  chase_days     int not null default 7,
  archived       boolean not null default false,
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists submittal_templates_job on submittal_templates (job_id);

-- ---------- access and archived jobs ----------
do $$
declare t text;
begin
  foreach t in array array['submittals', 'submittal_people', 'submittal_revisions', 'submittal_files', 'submittal_outbox', 'submittal_templates'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop policy if exists "signed-in users" on %I', t);
    execute format('create policy "signed-in users" on %I for all to authenticated using (true) with check (true)', t);
    execute format('drop policy if exists "access grid" on %I', t);
    execute format('create policy "access grid" on %I as restrictive for all to authenticated using (public.has_access(''job_rfis'')) with check (public.has_access(''job_rfis''))', t);
  end loop;
  foreach t in array array['submittal_people', 'submittal_revisions', 'submittal_files', 'submittal_outbox'] loop
    execute format('drop policy if exists "archived job: no changes" on %I', t);
    execute format('create policy "archived job: no changes" on %I as restrictive for all to authenticated using (true) with check (not exists (select 1 from submittals s where s.id = submittal_id and public.job_archived(s.job_id)))', t);
  end loop;
end $$;
drop policy if exists "archived job: no changes" on submittals;
create policy "archived job: no changes" on submittals as restrictive for all to authenticated using (true) with check (not public.job_archived(job_id));
drop policy if exists "archived job: no changes" on submittal_templates;
create policy "archived job: no changes" on submittal_templates as restrictive for all to authenticated using (true) with check (not public.job_archived(job_id));

insert into storage.buckets (id, name, public) values ('submittals', 'submittals', false) on conflict (id) do nothing;
drop policy if exists "submittals: read" on storage.objects;
drop policy if exists "submittals: add" on storage.objects;
drop policy if exists "submittals: remove" on storage.objects;
create policy "submittals: read" on storage.objects for select to authenticated using (bucket_id = 'submittals' and public.has_access('job_rfis'));
create policy "submittals: add" on storage.objects for insert to authenticated with check (bucket_id = 'submittals' and public.has_access('job_rfis'));
create policy "submittals: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'submittals' and public.has_access('job_rfis') and (owner = auth.uid() or public.is_admin()));

-- ---------- the bell ----------
create or replace function public.submittal_label(s submittals) returns text
language sql stable security definer set search_path = public as $$
  select j.job_no || ' ' || j.code from jobs j where j.id = s.job_id
$$;

-- out for review: the manager and DBP reviewers are told; outside reviewers' emails queue
create or replace function public.submittal_out() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; t text; l text;
begin
  if new.status <> 'out' or old.status = 'out' then return new; end if;
  t := public.submittal_label(new) || ' Submittal ' || new.number || ' out for review: ' || new.title;
  l := '/jobs/' || new.job_id || '/submittals/' || new.id;
  if new.manager_id is not null and new.manager_id is distinct from auth.uid() then
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (new.manager_id, new.job_id, 'submittal_new', t, 'You are the submittal manager.', new.due_date, l, 'submittals', new.id);
  end if;
  for p in select * from submittal_people where submittal_id = new.id loop
    if p.profile_id is not null and p.profile_id is distinct from new.manager_id and p.profile_id is distinct from auth.uid() then
      insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (p.profile_id, new.job_id, 'submittal_new', t, case p.role when 'reviewer' then 'For your review.' else 'You are copied in.' end, new.due_date, l, 'submittals', new.id);
    elsif p.directory_id is not null and p.role = 'reviewer' and new.notify then
      insert into submittal_outbox (submittal_id, person_id, kind) values (new.id, p.id, 'new');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists submittal_out on submittals;
create trigger submittal_out after update of status on submittals for each row execute function public.submittal_out();
-- (the app makes a submittal as a draft with its people, then sets it out, so they are told)

-- any response, void or approval closes the review reminders
create or replace function public.submittal_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'out' and old.status = 'out' then
    update notifications set status = 'done', auto_closed = true
     where source_table = 'submittals' and source_id = new.id and kind in ('submittal_new', 'submittal_chase') and status <> 'done';
  end if;
  return new;
end $$;
drop trigger if exists submittal_done on submittals;
create trigger submittal_done after update of status on submittals for each row execute function public.submittal_done();

-- ---------- chasing: called with rfi_chase_tick by the send-emails function ----------
create or replace function public.submittal_chase_tick() returns int
language plpgsql security definer set search_path = public as $$
declare s submittals; p record; n int := 0; hit uuid; t text; d text;
begin
  for s in
    select * from submittals
     where status = 'out' and chase_days > 0 and notify
       and current_date - coalesce(last_chased_at, submitted_at, created_at)::date >= chase_days
  loop
    if coalesce((select status = 'archived' from jobs where id = s.job_id), false) then continue; end if;
    t := public.submittal_label(s) || ' Submittal ' || s.number || ' still out for review: ' || s.title;
    d := case when s.due_date is null then 'No return date.' when s.due_date < current_date then 'Overdue: was due back ' || to_char(s.due_date, 'DD/MM/YYYY') || '.' else 'Due back ' || to_char(s.due_date, 'DD/MM/YYYY') || '.' end;
    for p in
      select s.manager_id as pid where s.manager_id is not null
      union select profile_id from submittal_people where submittal_id = s.id and role = 'reviewer' and profile_id is not null
    loop
      hit := null;
      select id into hit from notifications where kind = 'submittal_chase' and source_id = s.id and profile_id = p.pid and status <> 'done' limit 1;
      if hit is not null then
        update notifications set title = t, detail = d, due_date = s.due_date, created_at = now(), emailed_at = null where id = hit;
      else
        insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
        values (p.pid, s.job_id, 'submittal_chase', t, d, s.due_date, '/jobs/' || s.job_id || '/submittals/' || s.id, 'submittals', s.id);
      end if;
    end loop;
    insert into submittal_outbox (submittal_id, person_id, kind)
      select s.id, id, 'chase' from submittal_people where submittal_id = s.id and role = 'reviewer' and directory_id is not null;
    update submittals set last_chased_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.submittal_chase_tick() from public, anon, authenticated;
grant execute on function public.submittal_chase_tick() to service_role;
