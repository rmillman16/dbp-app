-- =====================================================================
-- 030 · Sampling tracker
-- Scope in docs/decisions.md ("Sampling module — scope", agreed 19 Nov).
-- 001 created finish_schedules and samples. This adds, for the first
-- version (22 Nov):
-- - quantity, and the programme activity a sample is needed for, with how
--   many weeks before it starts (the due date follows the programme)
-- - photos of approved samples and the designer's approval (email or
--   signed label) uploaded into the app: a private storage area "samples",
--   signed-in users only
-- - samples due (not yet submitted) on the bell
-- No existing data is lost.
-- =====================================================================

alter table samples add column if not exists quantity text;
alter table samples add column if not exists programme_task_code text;   -- the activity it's needed for (activity code)
alter table samples add column if not exists weeks_before numeric(5,1);  -- due this many weeks before it starts
alter table samples add column if not exists photo_path text;            -- in storage "samples"
alter table samples add column if not exists evidence_path text;         -- the approval email / signed label
alter table samples add column if not exists evidence_name text;
alter table samples add column if not exists created_at timestamptz not null default now();
alter table finish_schedules add column if not exists file_name text;

-- the storage area for photos and approvals (private: signed-in users only)
insert into storage.buckets (id, name, public) values ('samples', 'samples', false) on conflict (id) do nothing;
drop policy if exists "samples: signed-in read" on storage.objects;
drop policy if exists "samples: signed-in add" on storage.objects;
drop policy if exists "samples: signed-in change" on storage.objects;
drop policy if exists "samples: signed-in remove" on storage.objects;
create policy "samples: signed-in read" on storage.objects for select to authenticated using (bucket_id = 'samples');
create policy "samples: signed-in add" on storage.objects for insert to authenticated with check (bucket_id = 'samples');
create policy "samples: signed-in change" on storage.objects for update to authenticated using (bucket_id = 'samples') with check (bucket_id = 'samples');
create policy "samples: signed-in remove" on storage.objects for delete to authenticated using (bucket_id = 'samples');

-- samples due on the bell: one reminder per sample with a due date that hasn't been submitted yet
create or replace function public.sample_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from notifications
   where source_table = 'samples' and kind = 'sample_due' and status <> 'done'
     and source_id = case when tg_op = 'DELETE' then old.id else new.id end;
  if tg_op = 'DELETE' then return old; end if;
  if new.due_date is not null and new.status in ('not_requested', 'requested', 'rejected_resubmit') then
    insert into notifications (job_id, kind, title, detail, due_date, link, source_table, source_id)
    select new.job_id, 'sample_due',
           j.job_no || ' ' || j.code || ' sample due: ' || new.code,
           coalesce(new.description, new.material_group), new.due_date, '/jobs/' || new.job_id || '/sampling', 'samples', new.id
      from jobs j where j.id = new.job_id;
  end if;
  return new;
end $$;

drop trigger if exists sample_reminder on samples;
create trigger sample_reminder after insert or update of due_date, status, code, description or delete on samples
  for each row execute function public.sample_reminder();
