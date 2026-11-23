-- =====================================================================
-- 047 · O&M manual: the tracker, the file sections and reminders (23 Nov)
-- Agreed scope: an O&M tab on each job. One group per appointed
-- subcontractor (the job's orders), per client direct contractor, plus
-- project-specific items with no package (Reg 38 pack, BREEAM evidence…).
-- Documents stay in SharePoint (a link per document); the client's combined
-- PDF is built in the browser from the synced folder, nothing is uploaded.
-- - om_requirements: a sort order; a document line can belong to an order
--   (DBP subcontractor), to a company with no order (client direct
--   contractor, listed in job_directory with client_direct ticked) or to
--   neither (a job-level item). Lines whose standard document is later
--   removed from Settings keep their name. Deleting an order removes its
--   O&M lines
-- - om_job: the file sections typed per job (description of works, residual
--   risks register, project handover document)
-- - a new part of the app in Settings › Access, "Job › O&M". Starting ticks:
--   Project manager, Commercial, Site management. Payment notices can read
--   (not change) the O&M list, so "O&Ms outstanding" shows there too
-- - reminders: outstanding documents with a due date go on the bell of
--   everyone in the job's team (Overview › Team; the admins if the job has
--   no team yet): one reminder per person per subcontractor / contractor per
--   due date, e.g. "2611 FISL O&Ms: Acme Electrical: 5 documents due
--   01/03/2027". Kept up to date as documents and the team change: updated in
--   place, closed once nothing's outstanding, reopened if something is
--   rejected again. A reminder you mark done stays done
-- - an archived job's O&M is read-only, like everything else on it (042)
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

-- ---------- document lines ----------
alter table om_requirements add column if not exists sort int not null default 0;
create index if not exists om_requirements_job on om_requirements (job_id);

-- a standard document removed from Settings: its lines keep their own name
update om_requirements r set custom_name = d.name
  from om_doc_types d where d.id = r.doc_type_id and r.custom_name is null;
alter table om_requirements drop constraint if exists om_requirements_doc_type_id_fkey;
alter table om_requirements add constraint om_requirements_doc_type_id_fkey
  foreign key (doc_type_id) references om_doc_types(id) on delete set null;
-- deleting an order removes its O&M lines with it
alter table om_requirements drop constraint if exists om_requirements_order_id_fkey;
alter table om_requirements add constraint om_requirements_order_id_fkey
  foreign key (order_id) references orders(id) on delete cascade;

-- ---------- the file sections, per job ----------
create table if not exists om_job (
  job_id       uuid primary key references jobs(id) on delete cascade,
  description  text,                               -- description of works (typed by the PM for now)
  risks        jsonb not null default '[]'::jsonb, -- [{risk, location, controls, notes}]
  handover     jsonb not null default '{}'::jsonb, -- {training: [...], keys: [...], outstanding: [...], warranties: [...]}
  updated_at   timestamptz not null default now(),
  updated_by   uuid references profiles(id) on delete set null
);
drop trigger if exists t_om_job_upd on om_job;
create trigger t_om_job_upd before update on om_job for each row execute function set_updated_at();

alter table om_job enable row level security;
grant select, insert, update, delete on om_job to authenticated;
drop policy if exists "signed-in users" on om_job;
create policy "signed-in users" on om_job for all to authenticated using (true) with check (true);

-- ---------- who can open it (Settings › Access) ----------
insert into role_access (role, section) values ('project_manager', 'job_om'), ('commercial', 'job_om'), ('site_management', 'job_om')
on conflict do nothing;

drop policy if exists "access grid" on om_job;
create policy "access grid" on om_job as restrictive for all to authenticated
  using (public.has_access('job_om')) with check (public.has_access('job_om'));

-- the O&M list: read by O&M or payment notices (O&Ms outstanding), changed only from the O&M tab
drop policy if exists "access grid" on om_requirements;
drop policy if exists "access grid: add" on om_requirements;
drop policy if exists "access grid: change" on om_requirements;
drop policy if exists "access grid: delete" on om_requirements;
create policy "access grid" on om_requirements as restrictive for select to authenticated
  using (public.has_access('job_om') or public.has_access('job_commercial'));
create policy "access grid: add" on om_requirements as restrictive for insert to authenticated
  with check (public.has_access('job_om'));
create policy "access grid: change" on om_requirements as restrictive for update to authenticated
  using (public.has_access('job_om')) with check (public.has_access('job_om'));
create policy "access grid: delete" on om_requirements as restrictive for delete to authenticated
  using (public.has_access('job_om'));

-- the job's team stays with the job's Overview (as 043)
drop policy if exists "access grid" on job_team;
create policy "access grid" on job_team as restrictive for all to authenticated
  using (public.has_access('jobs')) with check (public.has_access('jobs'));

-- archived job: read-only (as 042)
do $$
declare t text;
begin
  foreach t in array array['om_job', 'om_requirements', 'job_team'] loop
    execute format('drop policy if exists "archived job: no adding" on public.%I', t);
    execute format('drop policy if exists "archived job: no changes" on public.%I', t);
    execute format('drop policy if exists "archived job: no deleting" on public.%I', t);
    execute format('create policy "archived job: no adding" on public.%I as restrictive for insert to authenticated with check (job_id is null or not public.job_archived(job_id))', t);
    execute format('create policy "archived job: no changes" on public.%I as restrictive for update to authenticated using (job_id is null or not public.job_archived(job_id)) with check (job_id is null or not public.job_archived(job_id))', t);
    execute format('create policy "archived job: no deleting" on public.%I as restrictive for delete to authenticated using (job_id is null or not public.job_archived(job_id))', t);
  end loop;
end $$;

-- ---------- reminders ----------
-- a reminder closed because nothing was outstanding any more (so it can reopen); one marked done by
-- its person stays done
alter table notifications add column if not exists auto_closed boolean not null default false;

-- who hears about a job's O&Ms: its team (Overview › Team); the admins if it has none
create or replace function public.om_team(p_job uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct profile_id from job_team where job_id = p_job and profile_id is not null
  union
  select id from profiles where is_admin and not exists (select 1 from job_team where job_id = p_job and profile_id is not null)
$$;

-- one job's O&M reminders, as things stand now: one per person per subcontractor / contractor
-- (job-level items together) per due date. Updated in place, never deleted and re-made.
create or replace function public.refresh_om_reminders(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
  g record;
  p uuid;
  hit uuid;
  keep uuid[] := '{}';
  t text;
  d text;
begin
  select * into j from jobs where id = p_job;
  if j.id is null then return; end if;
  for g in
    with outstanding as (
      select r.order_id, r.company_id, r.due_date, r.sort, coalesce(r.custom_name, dt.name, 'Document') as doc_name
      from om_requirements r left join om_doc_types dt on dt.id = r.doc_type_id
      where r.job_id = p_job and r.due_date is not null
        and r.status in ('not_requested', 'requested', 'rejected_resubmit')
    )
    select coalesce(o.order_id, o.company_id) as group_id, o.due_date,
           coalesce(min(oc.name), min(cc.name), 'Project items') as who,
           count(*) as n,
           string_agg(o.doc_name, ', ' order by o.sort, o.doc_name) as docs
    from outstanding o
    left join orders ord on ord.id = o.order_id
    left join companies oc on oc.id = ord.company_id
    left join companies cc on cc.id = o.company_id and o.order_id is null
    group by coalesce(o.order_id, o.company_id), o.due_date
  loop
    t := j.job_no || ' ' || j.code || ' O&Ms: ' || g.who || ': ' || g.n || case when g.n = 1 then ' document' else ' documents' end
         || ' due ' || to_char(g.due_date, 'DD/MM/YYYY');
    d := case when length(g.docs) > 240 then left(g.docs, 237) || '…' else g.docs end || '. Chase them from the O&M tab.';
    for p in select * from public.om_team(p_job) loop
      hit := null;
      select id into hit from notifications
       where kind = 'om_due' and job_id = p_job and profile_id = p and due_date = g.due_date
         and source_id is not distinct from g.group_id and (status <> 'done' or auto_closed)
       order by (status <> 'done') desc, created_at desc limit 1;
      if hit is not null then
        update notifications
           set title = t, detail = d, link = '/jobs/' || p_job || '/om', auto_closed = false,
               status = case when status = 'done' then 'open'::notif_status else status end
         where id = hit;
      elsif not exists (
        select 1 from notifications
         where kind = 'om_due' and job_id = p_job and profile_id = p and due_date = g.due_date and source_id is not distinct from g.group_id
      ) then
        insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
        values (p, p_job, 'om_due', t, d, g.due_date, '/jobs/' || p_job || '/om', 'om_requirements', g.group_id)
        returning id into hit;
      end if;
      -- (a reminder its person marked done while documents are still outstanding: left done)
      if hit is not null then keep := keep || hit; end if;
    end loop;
  end loop;
  -- anything no longer outstanding (or for someone no longer on the team) closes
  update notifications set status = 'done', auto_closed = true
   where kind = 'om_due' and job_id = p_job and status <> 'done' and not (id = any(keep));
end $$;

-- after any change to the O&M list or a job's team: refresh each job touched (once per statement)
create or replace function public.om_reminders_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare jid uuid;
begin
  if tg_op = 'INSERT' then
    for jid in select distinct job_id from new_rows where job_id is not null loop perform public.refresh_om_reminders(jid); end loop;
  elsif tg_op = 'UPDATE' then
    for jid in select job_id from new_rows where job_id is not null union select job_id from old_rows where job_id is not null loop
      perform public.refresh_om_reminders(jid);
    end loop;
  else
    for jid in select distinct job_id from old_rows where job_id is not null loop perform public.refresh_om_reminders(jid); end loop;
  end if;
  return null;
end $$;

drop trigger if exists om_reminders_ins on om_requirements;
drop trigger if exists om_reminders_upd on om_requirements;
drop trigger if exists om_reminders_del on om_requirements;
create trigger om_reminders_ins after insert on om_requirements referencing new table as new_rows
  for each statement execute function public.om_reminders_changed();
create trigger om_reminders_upd after update on om_requirements referencing old table as old_rows new table as new_rows
  for each statement execute function public.om_reminders_changed();
create trigger om_reminders_del after delete on om_requirements referencing old table as old_rows
  for each statement execute function public.om_reminders_changed();

drop trigger if exists om_team_ins on job_team;
drop trigger if exists om_team_upd on job_team;
drop trigger if exists om_team_del on job_team;
create trigger om_team_ins after insert on job_team referencing new table as new_rows
  for each statement execute function public.om_reminders_changed();
create trigger om_team_upd after update on job_team referencing old table as old_rows new table as new_rows
  for each statement execute function public.om_reminders_changed();
create trigger om_team_del after delete on job_team referencing old table as old_rows
  for each statement execute function public.om_reminders_changed();

-- the jobs already with O&M lines get their reminders now
do $$
declare jid uuid;
begin
  for jid in select distinct job_id from om_requirements loop
    perform public.refresh_om_reminders(jid);
  end loop;
end $$;
