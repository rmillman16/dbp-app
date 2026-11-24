-- =====================================================================
-- 081 · Health & Safety on each job, and the new parts of the access grid (24 Nov)
-- 1. Job › H&S: site diaries (one a day), delivery notes, and H&S inspections (a checklist with pass / fail, actions to close),
--    with photos (storage "hs"). Access follows the new part "Job › H&S".
-- 2. The access grid (Settings › Access) gets the parts that were riding on others: Job › Snagging (was RFIs & submittals),
--    Job › BREEAM (was Sampling), Job › Progress reports (was Jobs), Job › Project checklist (was Jobs), and Job › H&S. So nobody
--    loses anything, each new part starts ticked for every profile type that had the part it came from (H&S: Project manager and
--    Site management). Change the ticks in Settings › Access.
-- Run after 080. Safe to run more than once.
-- =====================================================================

-- ---------- 1. the starting ticks for the new parts ----------
insert into role_access (role, section) select role, 'job_snagging'  from role_access where section = 'job_rfis'     on conflict do nothing;
insert into role_access (role, section) select role, 'job_breeam'    from role_access where section = 'job_sampling' on conflict do nothing;
insert into role_access (role, section) select role, 'job_progress'  from role_access where section = 'jobs'         on conflict do nothing;
insert into role_access (role, section) select role, 'job_checklist' from role_access where section = 'jobs'         on conflict do nothing;
insert into role_access (role, section) values ('project_manager', 'job_hs'), ('site_management', 'job_hs') on conflict do nothing;

-- ---------- 2. the database follows the new parts ----------
-- snagging
do $$
declare t text;
begin
  foreach t in array array['snags', 'snag_files'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "access grid" on %I', t);
    execute format('create policy "access grid" on %I as restrictive for all to authenticated using (public.has_access(''job_snagging'')) with check (public.has_access(''job_snagging''))', t);
  end loop;
end $$;
drop policy if exists "snags: read" on storage.objects;
drop policy if exists "snags: add" on storage.objects;
drop policy if exists "snags: remove" on storage.objects;
create policy "snags: read" on storage.objects for select to authenticated using (bucket_id = 'snags' and public.has_access('job_snagging'));
create policy "snags: add" on storage.objects for insert to authenticated with check (bucket_id = 'snags' and public.has_access('job_snagging'));
create policy "snags: remove" on storage.objects for delete to authenticated using (bucket_id = 'snags' and public.has_access('job_snagging') and (owner = auth.uid() or public.is_admin()));
drop policy if exists "staff see link status" on snag_links;
create policy "staff see link status" on snag_links for select to authenticated using (public.has_access('job_snagging'));
create or replace function public.issue_snag_link(p_job uuid, p_company uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  if not public.has_access('job_snagging') then raise exception 'No access.'; end if;
  tok := translate(encode(gen_random_bytes(32), 'base64'), '+/=' || chr(10), '-_');
  insert into snag_links (job_id, company_id, token_hash, created_by) values (p_job, p_company, encode(digest(tok, 'sha256'), 'hex'), auth.uid());
  return tok;
end $$;
create or replace function public.revoke_snag_links(p_job uuid, p_company uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_access('job_snagging') then raise exception 'No access.'; end if;
  update snag_links set revoked_at = now() where job_id = p_job and company_id = p_company and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- BREEAM
do $$
declare t text;
begin
  foreach t in array array['breeam_items', 'breeam_evidence'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "access grid" on %I', t);
    execute format('create policy "access grid" on %I as restrictive for all to authenticated using (public.has_access(''job_breeam'')) with check (public.has_access(''job_breeam''))', t);
  end loop;
end $$;

-- progress reports
drop policy if exists "access grid" on progress_reports;
create policy "access grid" on progress_reports as restrictive for all to authenticated using (public.has_access('job_progress')) with check (public.has_access('job_progress'));
drop policy if exists "access grid" on progress_report_files;
create policy "access grid" on progress_report_files as restrictive for all to authenticated using (public.has_access('job_progress')) with check (public.has_access('job_progress'));
drop policy if exists "reports: read" on storage.objects;
drop policy if exists "reports: add" on storage.objects;
drop policy if exists "reports: remove" on storage.objects;
create policy "reports: read" on storage.objects for select to authenticated using (bucket_id = 'reports' and public.has_access('job_progress'));
create policy "reports: add" on storage.objects for insert to authenticated with check (bucket_id = 'reports' and public.has_access('job_progress'));
create policy "reports: remove" on storage.objects for delete to authenticated using (bucket_id = 'reports' and public.has_access('job_progress') and (owner = auth.uid() or public.is_admin()));

-- project checklist
drop policy if exists "access grid" on job_checklist;
create policy "access grid" on job_checklist as restrictive for all to authenticated using (public.has_access('job_checklist')) with check (public.has_access('job_checklist'));

-- ---------- 3. site diaries ----------
create table if not exists site_diaries (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  diary_date  date not null,
  weather     text,                                      -- e.g. Dry, bright
  temperature text,                                      -- e.g. 8°C
  labour      jsonb not null default '[]',               -- [{ "trade": "Joinery", "company": "Smith Joinery", "number": 4 }]
  work_done   text,                                      -- what was done today
  delays      text,                                      -- delays and why
  instructions text,                                     -- instructions received (who from)
  visitors    text,
  deliveries  text,                                      -- summary: the delivery notes have the detail
  plant       text,
  safety      text,                                      -- toolbox talks, accidents, near misses, observations
  notes       text,
  written_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (job_id, diary_date)
);
create index if not exists site_diaries_job on site_diaries (job_id, diary_date desc);

-- ---------- 4. delivery notes ----------
create table if not exists delivery_notes (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  delivered_on  date not null,
  supplier      text not null,
  note_ref      text,                                    -- the supplier's delivery note number
  order_ref     text,                                    -- our order / PO number
  description   text,                                    -- what was delivered
  quantity      text,
  received_by   text,
  condition     text not null default 'ok' check (condition in ('ok', 'damaged', 'short', 'rejected')),
  notes         text,
  created_by    uuid references profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists delivery_notes_job on delivery_notes (job_id, delivered_on desc);

-- ---------- 5. H&S inspections ----------
create table if not exists hs_inspections (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  inspected_on  date not null,
  kind          text not null,                           -- Weekly site inspection, Scaffold inspection, Fire safety walk, Other
  area          text,                                    -- where on site
  inspector     text,
  items         jsonb not null default '[]',             -- [{ "q": "Housekeeping", "result": "pass" | "fail" | "na", "note": "" }]
  result        text not null default 'satisfactory' check (result in ('satisfactory', 'actions', 'unsatisfactory')),
  actions       text,                                    -- what has to be done
  actions_due   date,
  actions_closed_on date,
  notes         text,
  created_by    uuid references profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists hs_inspections_job on hs_inspections (job_id, inspected_on desc);

-- photos for any of the three
create table if not exists hs_files (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  record_kind text not null check (record_kind in ('diary', 'delivery', 'inspection')),
  record_id   uuid not null,
  name        text not null,
  path        text not null,                             -- in storage "hs": <job id>/<time>-<file>
  uploaded_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists hs_files_record on hs_files (record_kind, record_id);

-- access: Job › H&S; an archived job is read-only; updated_at kept
do $$
declare t text;
begin
  foreach t in array array['site_diaries', 'delivery_notes', 'hs_inspections', 'hs_files'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop policy if exists "signed-in users" on %I', t);
    execute format('create policy "signed-in users" on %I for all to authenticated using (true) with check (true)', t);
    execute format('drop policy if exists "access grid" on %I', t);
    execute format('create policy "access grid" on %I as restrictive for all to authenticated using (public.has_access(''job_hs'')) with check (public.has_access(''job_hs''))', t);
    execute format('drop policy if exists "archived job: no changes" on %I', t);
    execute format('create policy "archived job: no changes" on %I as restrictive for all to authenticated using (true) with check (not public.job_archived(job_id))', t);
  end loop;
end $$;
do $$
declare t text;
begin
  foreach t in array array['site_diaries', 'delivery_notes', 'hs_inspections'] loop
    execute format('drop trigger if exists t_%s_upd on %I', t, t);
    execute format('create trigger t_%s_upd before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

insert into storage.buckets (id, name, public) values ('hs', 'hs', false) on conflict (id) do nothing;
update storage.buckets set file_size_limit = 26214400 where id = 'hs';
drop policy if exists "hs: read" on storage.objects;
drop policy if exists "hs: add" on storage.objects;
drop policy if exists "hs: remove" on storage.objects;
create policy "hs: read" on storage.objects for select to authenticated using (bucket_id = 'hs' and public.has_access('job_hs'));
create policy "hs: add" on storage.objects for insert to authenticated with check (bucket_id = 'hs' and public.has_access('job_hs'));
create policy "hs: remove" on storage.objects for delete to authenticated using (bucket_id = 'hs' and public.has_access('job_hs') and (owner = auth.uid() or public.is_admin()));
