-- =====================================================================
-- 059 · RFIs on estimates (tenders) as well as jobs (23 Nov)
-- Richard: link RFIs to Estimating. As with minutes (046), an RFI belongs to a job OR an Estimating enquiry; when the
-- enquiry is won and set up as a job, its RFIs (and its directory and templates) move to the job.
-- - rfis, rfi_templates and job_directory can belong to an enquiry (enquiry_id) instead of a job
-- - an enquiry's RFIs are numbered 1, 2, 3 within the enquiry; on moving to the job they carry on after the job's own
-- - who sees them: an enquiry's follow Estimating, a job's follow Job › RFIs & submittals. An enquiry's project
--   directory follows Estimating too
-- - bell reminders, chasers and the Monday report name the enquiry (E012) and link to the estimate's RFI
-- Safe to run more than once. No existing data is lost (run after 058).
-- =====================================================================

-- ---------- the project directory can belong to an enquiry ----------
alter table job_directory add column if not exists enquiry_id uuid references enquiries(id) on delete cascade;
alter table job_directory alter column job_id drop not null;
create index if not exists job_directory_enquiry on job_directory (enquiry_id);
alter table job_directory drop constraint if exists job_directory_job_or_enquiry;
alter table job_directory add constraint job_directory_job_or_enquiry check ((job_id is not null) <> (enquiry_id is not null)) not valid;
alter table job_directory validate constraint job_directory_job_or_enquiry;
drop policy if exists "access grid" on job_directory;
create policy "access grid" on job_directory as restrictive for all to authenticated
  using (case when enquiry_id is not null then public.has_access('estimating') else public.has_access('jobs') end)
  with check (case when enquiry_id is not null then public.has_access('estimating') else public.has_access('jobs') end);

-- ---------- RFIs and templates ----------
alter table rfis add column if not exists enquiry_id uuid references enquiries(id) on delete cascade;
alter table rfis alter column job_id drop not null;
create index if not exists rfis_enquiry on rfis (enquiry_id, number);
create unique index if not exists rfis_enquiry_number on rfis (enquiry_id, number) where enquiry_id is not null;
alter table rfis drop constraint if exists rfis_job_or_enquiry;
alter table rfis add constraint rfis_job_or_enquiry check ((job_id is not null) <> (enquiry_id is not null));

alter table rfi_templates add column if not exists enquiry_id uuid references enquiries(id) on delete cascade;
create index if not exists rfi_templates_enquiry on rfi_templates (enquiry_id);

-- numbered 1, 2, 3 within the job or the enquiry
create or replace function public.rfi_number() returns trigger
language plpgsql as $$
begin
  if new.number is null or new.number <= 0 then
    if new.enquiry_id is not null then
      select coalesce(max(number), 0) + 1 into new.number from rfis where enquiry_id = new.enquiry_id;
    else
      select coalesce(max(number), 0) + 1 into new.number from rfis where job_id = new.job_id;
    end if;
  end if;
  return new;
end $$;

-- ---------- who sees them ----------
create or replace function public.rfi_access(p_enquiry uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_enquiry is not null then public.has_access('estimating') else public.has_access('job_rfis') end
$$;
grant execute on function public.rfi_access(uuid) to authenticated;

drop policy if exists "access grid" on rfis;
create policy "access grid" on rfis as restrictive for all to authenticated
  using (public.rfi_access(enquiry_id)) with check (public.rfi_access(enquiry_id));
do $$
declare t text;
begin
  foreach t in array array['rfi_people', 'rfi_responses', 'rfi_files', 'rfi_outbox'] loop
    execute format('drop policy if exists "access grid" on %I', t);
    execute format('create policy "access grid" on %I as restrictive for all to authenticated using (exists (select 1 from rfis r where r.id = rfi_id and public.rfi_access(r.enquiry_id))) with check (exists (select 1 from rfis r where r.id = rfi_id and public.rfi_access(r.enquiry_id)))', t);
  end loop;
end $$;
-- (an archived job stays read-only: the 057 rules use job_archived(job_id), which is false for an enquiry's)

drop policy if exists "templates: project" on rfi_templates;
create policy "templates: project" on rfi_templates for all to authenticated
  using ((job_id is not null and public.has_access('job_rfis')) or (enquiry_id is not null and public.has_access('estimating')))
  with check ((job_id is not null and public.has_access('job_rfis') and not public.job_archived(job_id)) or (enquiry_id is not null and public.has_access('estimating')));

drop policy if exists "rfis: read" on storage.objects;
drop policy if exists "rfis: add" on storage.objects;
drop policy if exists "rfis: remove" on storage.objects;
create policy "rfis: read" on storage.objects for select to authenticated
  using (bucket_id = 'rfis' and (public.has_access('job_rfis') or public.has_access('estimating')));
create policy "rfis: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'rfis' and (public.has_access('job_rfis') or public.has_access('estimating')));
create policy "rfis: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'rfis' and (public.has_access('job_rfis') or public.has_access('estimating')) and (owner = auth.uid() or public.is_admin()));

-- ---------- bell reminders and chasers: name the job or the enquiry ----------
create or replace function public.rfi_label(r rfis) returns text
language sql stable security definer set search_path = public as $$
  select case when r.enquiry_id is not null
              then (select 'E' || lpad(e.enquiry_no::text, 3, '0') from enquiries e where e.id = r.enquiry_id)
              else (select j.job_no || ' ' || j.code from jobs j where j.id = r.job_id) end
$$;
create or replace function public.rfi_link(r rfis) returns text
language sql stable as $$
  select case when r.enquiry_id is not null then '/estimating/e/' || r.enquiry_id || '/rfis/' || r.id else '/jobs/' || r.job_id || '/rfis/' || r.id end
$$;

create or replace function public.rfi_new_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.manager_id is not null and new.manager_id is distinct from new.created_by then
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (new.manager_id, new.job_id, 'rfi_new', public.rfi_label(new) || ' RFI ' || new.number || ': ' || new.title,
            'You are the RFI manager.', new.due_date, public.rfi_link(new), 'rfis', new.id);
  end if;
  return new;
end $$;

create or replace function public.rfi_person_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r rfis;
begin
  if new.profile_id is null then return new; end if;
  select * into r from rfis where id = new.rfi_id;
  if new.profile_id is not distinct from r.created_by or new.profile_id is not distinct from r.manager_id then return new; end if;
  insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
  values (new.profile_id, r.job_id, 'rfi_new', public.rfi_label(r) || ' RFI ' || r.number || ': ' || r.title,
          case new.role when 'assignee' then 'Assigned to you.' else 'You are copied in.' end, r.due_date, public.rfi_link(r), 'rfis', r.id);
  return new;
end $$;

create or replace function public.rfi_reply_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r rfis;
begin
  select * into r from rfis where id = new.rfi_id;
  if new.kind = 'reply' and r.status = 'open' and new.author_id is distinct from r.manager_id then
    update rfis set status = 'answered' where id = r.id;
  end if;
  if r.manager_id is not null and new.author_id is distinct from r.manager_id and new.kind <> 'note' then
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (r.manager_id, r.job_id, 'rfi_answered', public.rfi_label(r) || ' RFI ' || r.number || ' has a reply: ' || r.title,
            coalesce(new.author_name, 'Someone') || ' replied. Review it, then close the RFI.', null, public.rfi_link(r), 'rfis', r.id);
  end if;
  return new;
end $$;

create or replace function public.rfi_chase_tick() returns int
language plpgsql security definer set search_path = public as $$
declare r rfis; p record; n int := 0; hit uuid; t text; d text; skip boolean;
begin
  for r in
    select * from rfis
     where status = 'open' and chase_days > 0 and notify
       and current_date - coalesce(last_chased_at, created_at)::date >= chase_days
  loop
    skip := case when r.enquiry_id is not null then coalesce((select status in ('lost') from enquiries where id = r.enquiry_id), false)
                 else coalesce((select status = 'archived' from jobs where id = r.job_id), false) end;
    if skip then continue; end if;
    t := public.rfi_label(r) || ' RFI ' || r.number || ' still unanswered: ' || r.title;
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
        values (p.pid, r.job_id, 'rfi_chase', t, d, r.due_date, public.rfi_link(r), 'rfis', r.id);
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

-- ---------- an enquiry won and set up as a job: its RFIs, directory and templates become the job's ----------
create or replace function public.enquiry_rfis_to_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; n int;
begin
  if new.job_id is null or new.job_id is not distinct from old.job_id then return new; end if;
  update job_directory set job_id = new.job_id, enquiry_id = null where enquiry_id = new.id;
  update rfi_templates set job_id = new.job_id, enquiry_id = null where enquiry_id = new.id;
  -- numbered on after the job's own
  for r in select id from rfis where enquiry_id = new.id order by number loop
    select coalesce(max(number), 0) + 1 into n from rfis where job_id = new.job_id;
    update rfis set job_id = new.job_id, enquiry_id = null, number = n where id = r.id;
    update notifications set job_id = new.job_id, link = '/jobs/' || new.job_id || '/rfis/' || r.id
     where source_table = 'rfis' and source_id = r.id;
  end loop;
  return new;
end $$;
drop trigger if exists enquiry_rfis_to_job on enquiries;
create trigger enquiry_rfis_to_job after update of job_id on enquiries for each row execute function public.enquiry_rfis_to_job();
