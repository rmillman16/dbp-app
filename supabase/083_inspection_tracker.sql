-- =====================================================================
-- 083 · Inspection tracker (24 Nov)
-- Job › H&S › Inspections becomes a tracker for the inspections done by OTHER parties (scaffolders, lifting-equipment examiners, fire
-- alarm engineers, the H&S consultant's audits...): each inspection has how often it is due; each report that comes in is logged with
-- its date and the report itself; the next one falls due the frequency after the last. From a few days before it is due, the job's
-- PMs (or the person chosen) get a reminder on the bell and by email, and an overdue one is chased every week until a report is
-- logged. Reports are kept in the app (storage "hs") and, if the job's SharePoint H&S folder is linked on that computer, filed there too.
-- Run after 082. The old in-app inspection checklists (081) are left in the database, unused. Safe to run more than once.
-- =====================================================================
create table if not exists hs_trackers (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references jobs(id) on delete cascade,
  name           text not null,                          -- e.g. Scaffold inspection
  by_party       text,                                   -- who does it: the company or person
  frequency_days int check (frequency_days is null or frequency_days > 0),   -- null = a one-off
  first_due      date not null default current_date,     -- when the first one is due (later ones: the last report + frequency)
  remind_days    int not null default 3 check (remind_days >= 0),            -- remind this many days before it is due
  owner_id       uuid references profiles(id) on delete set null,            -- who is reminded; empty = the job's PMs
  active         boolean not null default true,
  last_chased_on date,                                   -- when an overdue one was last chased
  notes          text,
  created_by     uuid references profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists hs_trackers_job on hs_trackers (job_id);

create table if not exists hs_reports (
  id           uuid primary key default gen_random_uuid(),
  tracker_id   uuid not null references hs_trackers(id) on delete cascade,
  job_id       uuid not null references jobs(id) on delete cascade,
  inspected_on date not null,                            -- the date of the inspection
  outcome      text not null default 'satisfactory' check (outcome in ('satisfactory', 'actions', 'unsatisfactory')),
  note         text,
  path         text,                                     -- the report, in storage "hs"
  file_name    text,
  filed_to     text,                                     -- where it was filed in the synced SharePoint folder, if it was
  uploaded_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists hs_reports_tracker on hs_reports (tracker_id, inspected_on desc);

do $$
declare t text;
begin
  foreach t in array array['hs_trackers', 'hs_reports'] loop
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
drop trigger if exists t_hs_trackers_upd on hs_trackers;
create trigger t_hs_trackers_upd before update on hs_trackers for each row execute function set_updated_at();
grant select, insert, update, delete on hs_trackers, hs_reports to service_role;

-- a report logged closes that inspection's reminders straight away (and the next chase starts afresh)
create or replace function public.hs_report_logged() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update notifications set status = 'done', auto_closed = true
   where source_table = 'hs_trackers' and source_id = new.tracker_id and kind in ('hs_inspection_due', 'hs_inspection_overdue') and status <> 'done';
  update hs_trackers set last_chased_on = null where id = new.tracker_id;
  return new;
end $$;
drop trigger if exists hs_report_logged on hs_reports;
create trigger hs_report_logged after insert on hs_reports for each row execute function public.hs_report_logged();

-- ---------- the reminders ----------
-- Called by the send-emails function every couple of minutes (server key). For each active inspection on a live job: the next one is
-- due the frequency after the last report (else on its first due date; a one-off is only due until it has a report). From
-- "remind days" before, the person chosen (else the job's PMs, else the job's team / admins) get one reminder on the bell, kept up to
-- date; once it is overdue they get a fresh, emailed chase every 7 days until a report is logged. Returns how many are due.
create or replace function public.hs_inspection_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare t hs_trackers; j jobs; due date; p uuid; hit uuid; rec uuid[]; keep uuid[] := '{}'; n int := 0; ttl text; det text; chase boolean; last_on date;
begin
  for t in select * from hs_trackers where active loop
    select * into j from jobs where id = t.job_id;
    if j.id is null or j.status <> 'live' then continue; end if;
    select max(inspected_on) into last_on from hs_reports where tracker_id = t.id;
    due := case when t.frequency_days is null then (case when last_on is null then t.first_due end) else coalesce(last_on + t.frequency_days, t.first_due) end;
    if due is null or due > current_date + t.remind_days then continue; end if;
    chase := due < current_date and (t.last_chased_on is null or t.last_chased_on <= current_date - 7);
    ttl := j.job_no || ' ' || j.code || ' inspection ' || case when due < current_date then 'OVERDUE' else 'due' end || ': ' || t.name || ' (' || to_char(due, 'DD/MM/YYYY') || ')';
    det := coalesce('By ' || nullif(t.by_party, '') || '. ', '') || 'Log the report in Job › H&S › Inspections when it comes in.';
    rec := case when t.owner_id is not null then array[t.owner_id]
                else coalesce((select array_agg(distinct profile_id) from job_team where job_id = t.job_id and profile_id is not null and role ~* '\ypm\y|project manager'), '{}') end;
    if cardinality(rec) = 0 then rec := array(select public.om_team(t.job_id)); end if;
    foreach p in array rec loop
      hit := null;
      if chase then
        insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
        values (p, t.job_id, 'hs_inspection_overdue', ttl, det, due, '/jobs/' || t.job_id || '/hs?v=inspections', 'hs_trackers', t.id) returning id into hit;
      else
        select id into hit from notifications where source_table = 'hs_trackers' and source_id = t.id and profile_id = p and kind in ('hs_inspection_due', 'hs_inspection_overdue') and status <> 'done' order by created_at desc limit 1;
        if hit is not null then
          update notifications set title = ttl, due_date = due, detail = det where id = hit;
        else
          insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
          values (p, t.job_id, 'hs_inspection_due', ttl, det, due, '/jobs/' || t.job_id || '/hs?v=inspections', 'hs_trackers', t.id) returning id into hit;
        end if;
      end if;
      if hit is not null then keep := keep || hit; end if;
    end loop;
    if chase then update hs_trackers set last_chased_on = current_date where id = t.id; end if;
    n := n + 1;
  end loop;
  -- no longer due (a report was logged, it was paused or the job is no longer live) or replaced by a fresh chase: closed
  update notifications set status = 'done', auto_closed = true
   where source_table = 'hs_trackers' and kind in ('hs_inspection_due', 'hs_inspection_overdue') and status <> 'done' and not (id = any(keep));
  return n;
end $$;
revoke execute on function public.hs_inspection_reminders() from public, anon, authenticated;
grant execute on function public.hs_inspection_reminders() to service_role;
