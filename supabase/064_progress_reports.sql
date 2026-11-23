-- =====================================================================
-- 064 · Progress reports within jobs (23 Nov), as agreed 19 Nov (docs/decisions.md "Progress reports")
-- - Job › Progress reports: numbered reports per job, each for a period, written by the PM in numbered sections that can be
--   switched off per job (programme and progress, design, procurement, information required, contract, commercial,
--   site-specific headings, health and safety), with a cover and summary page, photos, and appendices
-- - the report pulls what the app already knows at the time it is made (programme, RFIs, submittals, sampling, procurement,
--   variation and EOT status, insurances); the PM writes and edits the narrative. Output: a combined PDF (body and
--   appendices) and an editable Word file
-- - the frequency is set per job (jobs.report_frequency_days, already there); the job's team is reminded on the bell
--   when the next report is due
-- - who can open it follows "Jobs" (as before, 043); an archived job's reports are read-only
-- Safe to run more than once. No existing data is lost (run after 063).
-- =====================================================================
alter table progress_reports add column if not exists title      text;
alter table progress_reports add column if not exists content    jsonb not null default '{}'::jsonb;   -- the PM's text and figures
alter table progress_reports add column if not exists issued_on  date;
alter table progress_reports add column if not exists prepared_by uuid references profiles(id) on delete set null default auth.uid();
alter table progress_reports add column if not exists updated_at timestamptz not null default now();
alter table progress_reports alter column sections set default '{}'::jsonb;
drop trigger if exists t_progress_reports_upd on progress_reports;
create trigger t_progress_reports_upd before update on progress_reports for each row execute function set_updated_at();

-- photos and the appendices the PM adds (PDFs are merged into the combined PDF)
create table if not exists progress_report_files (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references progress_reports(id) on delete cascade,
  kind        text not null check (kind in ('photo', 'appendix')),
  name        text not null,                         -- appendix title, or the photo's caption
  path        text not null,                         -- in storage "reports": <report id>/<time>-<file>
  file_name   text not null,
  caption     text,
  sort        int not null default 0,
  uploaded_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists progress_report_files_r on progress_report_files (report_id, kind, sort);
alter table progress_report_files enable row level security;
grant select, insert, update, delete on progress_report_files to authenticated;
drop policy if exists "signed-in users" on progress_report_files;
create policy "signed-in users" on progress_report_files for all to authenticated using (true) with check (true);
drop policy if exists "access grid" on progress_report_files;
create policy "access grid" on progress_report_files as restrictive for all to authenticated
  using (public.has_access('jobs')) with check (public.has_access('jobs'));
drop policy if exists "archived job: no changes" on progress_report_files;
create policy "archived job: no changes" on progress_report_files as restrictive for all to authenticated
  using (true) with check (not exists (select 1 from progress_reports r where r.id = report_id and public.job_archived(r.job_id)));

insert into storage.buckets (id, name, public) values ('reports', 'reports', false) on conflict (id) do nothing;
update storage.buckets set file_size_limit = 52428800 where id = 'reports';
drop policy if exists "reports: read" on storage.objects;
drop policy if exists "reports: add" on storage.objects;
drop policy if exists "reports: remove" on storage.objects;
create policy "reports: read" on storage.objects for select to authenticated using (bucket_id = 'reports' and public.has_access('jobs'));
create policy "reports: add" on storage.objects for insert to authenticated with check (bucket_id = 'reports' and public.has_access('jobs'));
create policy "reports: remove" on storage.objects for delete to authenticated using (bucket_id = 'reports' and public.has_access('jobs') and (owner = auth.uid() or public.is_admin()));

-- ---------- the reminder: the next report is due ----------
-- Called by the send-emails function every couple of minutes (server key). For each live job with a report frequency: the
-- next report is due the frequency after the last report's period end (else the job's start). From 3 days before it is
-- due, the job's team (the admins if there is no team) get it on the bell, updated in place; it closes once a report
-- covers it. Returns how many jobs have one due.
create or replace function public.progress_report_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare j jobs; last_end date; due date; p uuid; hit uuid; keep uuid[] := '{}'; n int := 0; t text; nxt int;
begin
  for j in select * from jobs where status = 'live' and coalesce(report_frequency_days, 0) > 0 loop
    last_end := coalesce((select max(period_end) from progress_reports where job_id = j.id), j.start_date, j.created_at::date);
    due := last_end + j.report_frequency_days;
    if due > current_date + 3 then continue; end if;
    select coalesce(max(report_no), 0) + 1 into nxt from progress_reports where job_id = j.id;
    t := j.job_no || ' ' || j.code || ' progress report ' || nxt || ' due ' || to_char(due, 'DD/MM/YYYY');
    for p in select * from public.om_team(j.id) loop
      hit := null;
      select id into hit from notifications where kind = 'report_due' and job_id = j.id and profile_id = p and (status <> 'done' or auto_closed) order by (status <> 'done') desc, created_at desc limit 1;
      if hit is not null then
        update notifications set title = t, due_date = due, link = '/jobs/' || j.id || '/progress', auto_closed = false,
               status = case when status = 'done' then 'open'::notif_status else status end where id = hit;
      else
        insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
        values (p, j.id, 'report_due', t, 'Start it from Job › Progress reports: the programme, RFIs, submittals and the rest are pulled in for you.', due, '/jobs/' || j.id || '/progress', 'jobs', j.id)
        returning id into hit;
      end if;
      if hit is not null then keep := keep || hit; end if;
    end loop;
    n := n + 1;
  end loop;
  -- no longer due (a report was made), or the job is no longer live: closed
  update notifications set status = 'done', auto_closed = true where kind = 'report_due' and status <> 'done' and not (id = any(keep));
  return n;
end $$;
revoke execute on function public.progress_report_reminders() from public, anon, authenticated;
grant execute on function public.progress_report_reminders() to service_role;
