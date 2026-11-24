-- =====================================================================
-- 070 · Snagging (24 Nov)
-- Richard: mainly used on a phone. A form per snag with:
--  - a number that counts up from 1 on each job and can never be changed, repeated or reused (unique across every trade)
--  - status (incomplete / complete), a name, who raised it (the approver, taken from whoever makes it), the assignee (a
--    subcontractor from the job's project directory; new people can be added there), a location, and photos taken on the phone
--  - the office can filter by trade and compile a snag list (all, or one per trade) and email it to each trade
--  - trades people open their own list on a private link WITHOUT a login (separate from the RFI / submittal pages), tick a snag
--    as done and can add a photo as proof. The approver then gets a task to check it.
-- How outside access works is the same as for RFIs (061): the trades person is not a user of the app. Their page talks only to
-- the "snag-external" Edge Function; the link's token is random and only its hash is stored; it expires; DBP can withdraw it.
-- Access follows "Job › RFIs & submittals" (job_rfis). An archived job is read-only. Safe to run more than once (run after 069).
-- =====================================================================

-- ---------- the snags ----------
alter table jobs add column if not exists snag_counter int not null default 0;     -- the last snag number used on the job (never reused)

create table if not exists snags (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references jobs(id) on delete cascade,
  number         int not null default 0,                    -- 1, 2, 3 on each job: set by the database, never changed
  title          text not null,                             -- the snag's name
  description    text,
  location       text,
  status         text not null default 'incomplete' check (status in ('incomplete', 'complete')),
  raised_by      uuid references profiles(id) on delete set null default auth.uid(),   -- the approver: whoever made it
  assignee_id    uuid references job_directory(id) on delete set null,                 -- the subcontractor (project directory)
  trade          text,                                      -- from the assignee's company, so lists can be filtered by trade
  marked_done_at timestamptz,                               -- the trade says it is done: waiting for the approver to check
  marked_done_by text,
  done_note      text,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (job_id, number)
);
create index if not exists snags_job on snags (job_id, number);
create index if not exists snags_assignee on snags (assignee_id);

-- the number: the next one on the job, taken from a counter on the job so a number is never used twice (even after a delete)
create or replace function public.snag_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update jobs set snag_counter = snag_counter + 1 where id = new.job_id returning snag_counter into n;
  new.number := n;
  return new;
end $$;
drop trigger if exists snag_number on snags;
create trigger snag_number before insert on snags for each row execute function public.snag_number();

create or replace function public.snag_guard() returns trigger
language plpgsql as $$
begin
  if new.number is distinct from old.number then raise exception 'A snag''s number cannot be changed.'; end if;
  if new.job_id is distinct from old.job_id then raise exception 'A snag cannot move to another job.'; end if;
  if new.status = 'complete' and old.status <> 'complete' then new.completed_at := now(); end if;
  if new.status = 'incomplete' and old.status = 'complete' then new.completed_at := null; end if;
  return new;
end $$;
drop trigger if exists snag_guard on snags;
create trigger snag_guard before update on snags for each row execute function public.snag_guard();

create table if not exists snag_files (
  id          uuid primary key default gen_random_uuid(),
  snag_id     uuid not null references snags(id) on delete cascade,
  kind        text not null default 'raised' check (kind in ('raised', 'proof')),   -- the photo of the snag / the trade's proof it is done
  name        text not null,
  path        text not null,                               -- in storage "snags": <snag id>/<time>-<file>
  uploaded_by uuid references profiles(id) on delete set null default auth.uid(),    -- null = the trades person
  created_at  timestamptz not null default now()
);
create index if not exists snag_files_snag on snag_files (snag_id);

-- ---------- access, archived jobs, and who may delete ----------
do $$
declare t text;
begin
  foreach t in array array['snags', 'snag_files'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop policy if exists "signed-in users" on %I', t);
    execute format('create policy "signed-in users" on %I for all to authenticated using (true) with check (true)', t);
    execute format('drop policy if exists "access grid" on %I', t);
    execute format('create policy "access grid" on %I as restrictive for all to authenticated using (public.has_access(''job_rfis'')) with check (public.has_access(''job_rfis''))', t);
  end loop;
end $$;
drop policy if exists "archived job: no changes" on snags;
create policy "archived job: no changes" on snags as restrictive for all to authenticated using (true) with check (not public.job_archived(job_id));
drop policy if exists "archived job: no changes" on snag_files;
create policy "archived job: no changes" on snag_files as restrictive for all to authenticated using (true) with check (not exists (select 1 from snags s where s.id = snag_id and public.job_archived(s.job_id)));
-- a snag can only be deleted by an admin (its number is never reused anyway)
drop policy if exists "admins delete snags" on snags;
create policy "admins delete snags" on snags as restrictive for delete to authenticated using (public.is_admin());

-- photos
insert into storage.buckets (id, name, public) values ('snags', 'snags', false) on conflict (id) do nothing;
drop policy if exists "snags: read" on storage.objects;
drop policy if exists "snags: add" on storage.objects;
drop policy if exists "snags: remove" on storage.objects;
create policy "snags: read" on storage.objects for select to authenticated using (bucket_id = 'snags' and public.has_access('job_rfis'));
create policy "snags: add" on storage.objects for insert to authenticated with check (bucket_id = 'snags' and public.has_access('job_rfis'));
create policy "snags: remove" on storage.objects for delete to authenticated using (bucket_id = 'snags' and public.has_access('job_rfis') and (owner = auth.uid() or public.is_admin()));

-- ---------- the task for the approver: a trade says it is done, so check it ----------
create or replace function public.snag_marked_done() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jobs;
begin
  select * into j from jobs where id = new.job_id;
  -- the trade ticked it: the approver is asked to check it
  if new.marked_done_at is not null and old.marked_done_at is null and new.status = 'incomplete' and new.raised_by is not null then
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (new.raised_by, new.job_id, 'snag_check', j.job_no || ' ' || j.code || ' Snag ' || new.number || ' marked done: ' || new.title,
            coalesce(new.marked_done_by, 'The trade') || ' says it is done' || coalesce(' (' || nullif(new.location, '') || ')', '') || '. Check it, then mark it complete or send it back.',
            null, '/jobs/' || new.job_id || '/snagging/' || new.id, 'snags', new.id);
  end if;
  -- checked (complete) or sent back (the tick removed): the task is closed
  if (new.status = 'complete' and old.status <> 'complete') or (new.marked_done_at is null and old.marked_done_at is not null) then
    update notifications set status = 'done', auto_closed = true
     where source_table = 'snags' and source_id = new.id and kind = 'snag_check' and status <> 'done';
  end if;
  return new;
end $$;
drop trigger if exists snag_marked_done on snags;
create trigger snag_marked_done after update on snags for each row execute function public.snag_marked_done();

-- ---------- private links for the trades ----------
-- One link per job per company: it opens that company's snags on that job, nothing else.
create table if not exists snag_links (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  token_hash   text not null unique,                       -- sha256 of the token (the token itself is never stored)
  created_by   uuid references profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '180 days',
  revoked_at   timestamptz,
  last_used_at timestamptz,
  use_count    int not null default 0
);
create index if not exists snag_links_job on snag_links (job_id, company_id);
alter table snag_links enable row level security;
revoke all on snag_links from anon, authenticated;
grant select (id, job_id, company_id, created_at, expires_at, revoked_at, last_used_at, use_count) on snag_links to authenticated;
drop policy if exists "staff see link status" on snag_links;
create policy "staff see link status" on snag_links for select to authenticated using (public.has_access('job_rfis'));

-- staff: a link for one company on one job (returns the token, shown once; copy it into your own email)
create or replace function public.issue_snag_link(p_job uuid, p_company uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  if not public.has_access('job_rfis') then raise exception 'No access.'; end if;
  tok := translate(encode(gen_random_bytes(32), 'base64'), '+/=' || chr(10), '-_');
  insert into snag_links (job_id, company_id, token_hash, created_by) values (p_job, p_company, encode(digest(tok, 'sha256'), 'hex'), auth.uid());
  return tok;
end $$;
grant execute on function public.issue_snag_link(uuid, uuid) to authenticated;

create or replace function public.revoke_snag_links(p_job uuid, p_company uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_access('job_rfis') then raise exception 'No access.'; end if;
  update snag_links set revoked_at = now() where job_id = p_job and company_id = p_company and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.revoke_snag_links(uuid, uuid) to authenticated;

-- the server (the snag-external function) uses these tables
grant select, insert, update, delete on snags, snag_files, snag_links to service_role;
grant select, update on jobs to service_role;
