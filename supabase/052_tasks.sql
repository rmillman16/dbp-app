-- =====================================================================
-- 052 · Tasks (23 Nov)
-- Richard: "change My tasks to Tasks and build in a feature to create tasks
-- just within that element and then also assign other du Boulay team
-- members tasks". A task: what, for whom (any staff login, yourself
-- included), when it's due, optionally which job, and notes.
-- - the person it's for gets it on their bell (and the job's TODO, by email
--   once emails are set up); giving it to someone else moves it; done
--   closes it, and the person who set it hears it's done
-- - you see tasks given to you and tasks you've set; admins see all
-- - on an archived job tasks are read-only, like everything else there
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  notes        text,
  job_id       uuid references jobs(id) on delete cascade,
  assigned_to  uuid not null references profiles(id) on delete cascade,
  created_by   uuid references profiles(id) on delete set null default auth.uid(),
  due_date     date,
  done         boolean not null default false,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_assigned on tasks (assigned_to) where not done;
create index if not exists tasks_created_by on tasks (created_by);
create index if not exists tasks_job on tasks (job_id);
drop trigger if exists t_tasks_upd on tasks;
create trigger t_tasks_upd before update on tasks for each row execute function set_updated_at();

alter table tasks enable row level security;
drop policy if exists "tasks: read" on tasks;
drop policy if exists "tasks: set" on tasks;
drop policy if exists "tasks: change" on tasks;
drop policy if exists "tasks: delete" on tasks;
create policy "tasks: read" on tasks for select to authenticated using (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin());
create policy "tasks: set" on tasks for insert to authenticated with check (created_by = auth.uid());
create policy "tasks: change" on tasks for update to authenticated
  using (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin())
  with check (assigned_to is not null);
create policy "tasks: delete" on tasks for delete to authenticated using (created_by = auth.uid() or public.is_admin());
-- archived jobs read-only (as 042)
drop policy if exists "archived job: no adding" on tasks;
drop policy if exists "archived job: no changes" on tasks;
drop policy if exists "archived job: no deleting" on tasks;
create policy "archived job: no adding" on tasks as restrictive for insert to authenticated with check (job_id is null or not public.job_archived(job_id));
create policy "archived job: no changes" on tasks as restrictive for update to authenticated using (job_id is null or not public.job_archived(job_id)) with check (job_id is null or not public.job_archived(job_id));
create policy "archived job: no deleting" on tasks as restrictive for delete to authenticated using (job_id is null or not public.job_archived(job_id));
grant select, insert, update, delete on tasks to authenticated;

-- the bell: one open reminder per task, for whoever it's for; done (or deleted) closes it
create or replace function public.task_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  j jobs;
  setter text;
begin
  if tg_op = 'DELETE' then
    update notifications set status = 'done' where source_table = 'tasks' and source_id = old.id and status <> 'done';
    return old;
  end if;
  t := new;
  if tg_op = 'UPDATE' and (t.title, t.notes, t.job_id, t.assigned_to, t.due_date, t.done) is not distinct from (old.title, old.notes, old.job_id, old.assigned_to, old.due_date, old.done) then
    return new;
  end if;
  select * into j from jobs where id = t.job_id;
  select coalesce(nullif(full_name, ''), email) into setter from profiles where id = t.created_by;
  -- someone else's reminder (given to another person): close it
  update notifications set status = 'done'
   where source_table = 'tasks' and source_id = t.id and kind = 'task' and status <> 'done' and profile_id is distinct from t.assigned_to;
  if t.done then
    update notifications set status = 'done' where source_table = 'tasks' and source_id = t.id and kind = 'task' and status <> 'done';
    -- done by someone other than the setter: the setter hears
    if tg_op = 'UPDATE' and not old.done and t.created_by is not null and t.created_by is distinct from auth.uid() then
      insert into notifications (profile_id, job_id, kind, title, link, source_table, source_id)
      values (t.created_by, t.job_id, 'task_done',
              'Done: ' || t.title || coalesce(' (' || (select coalesce(nullif(full_name, ''), email) from profiles where id = t.assigned_to) || ')', ''),
              '/tasks', 'tasks', t.id);
    end if;
    return new;
  end if;
  if exists (select 1 from notifications where source_table = 'tasks' and source_id = t.id and kind = 'task' and profile_id = t.assigned_to and status <> 'done') then
    update notifications
       set title = coalesce(j.job_no || ' ' || j.code || ': ', '') || t.title,
           detail = concat_ws(' · ', case when t.created_by is distinct from t.assigned_to then 'From ' || setter end, left(t.notes, 200)),
           due_date = t.due_date, job_id = t.job_id
     where source_table = 'tasks' and source_id = t.id and kind = 'task' and profile_id = t.assigned_to and status <> 'done';
  else
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (t.assigned_to, t.job_id, 'task',
            coalesce(j.job_no || ' ' || j.code || ': ', '') || t.title,
            concat_ws(' · ', case when t.created_by is distinct from t.assigned_to then 'From ' || setter end, left(t.notes, 200)),
            t.due_date, '/tasks', 'tasks', t.id);
  end if;
  return new;
end $$;
drop trigger if exists task_changed on tasks;
create trigger task_changed after insert or update or delete on tasks for each row execute function public.task_changed();

-- Done on the bell ticks the task (for the person it's for)
create or replace function public.task_done_from_bell() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'task' and new.status = 'done' and old.status <> 'done' and new.profile_id = auth.uid() then
    update tasks set done = true, done_at = now() where id = new.source_id and assigned_to = auth.uid() and not done;
  end if;
  return new;
end $$;
drop trigger if exists task_done_from_bell on notifications;
create trigger task_done_from_bell after update of status on notifications for each row execute function public.task_done_from_bell();
