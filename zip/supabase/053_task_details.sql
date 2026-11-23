-- =====================================================================
-- 053 · Task details, as in Microsoft To Do (23 Nov)
-- Richard: a task opens into a detail panel "set up like Microsoft To Do".
-- Run after 052. What it adds to each task:
-- - Important (the star): important tasks sort first
-- - Steps: a checklist inside the task (kept with the task)
-- - Add to My Day: on that person's Home page for the day it was added;
--   it clears itself the next day
-- - Remind me on a date: a reminder on the bell of the person it's for,
--   shown from that day (not before) and emailed that day. Changing the
--   date moves it; clearing it, done or deleting the task closes it
-- - Repeat (daily, weekdays, weekly, monthly, yearly): ticking a repeating
--   task done sets up the next one (due date moved on, steps unticked,
--   notes, person, job, star and repeat copied), from the Tasks page or
--   from Done on the bell
-- - Files on a task (private storage area "tasks"): seen by whoever can see
--   the task; you can remove the ones you added (admins any)
-- Bell links for tasks now open the task itself.
-- On an archived job tasks and their files stay read-only.
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

alter table tasks add column if not exists important boolean not null default false;
alter table tasks add column if not exists steps jsonb not null default '[]'::jsonb;   -- [{id, title, done}]
alter table tasks add column if not exists my_day date;                                 -- the day it was added to My Day
alter table tasks add column if not exists remind_on date;
alter table tasks add column if not exists repeat text;
alter table tasks add column if not exists repeated_to uuid references tasks(id) on delete set null; -- the next one, once set up
alter table tasks drop constraint if exists tasks_repeat_check;
alter table tasks add constraint tasks_repeat_check check (repeat is null or repeat in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly'));
alter table tasks drop constraint if exists tasks_steps_check;
alter table tasks add constraint tasks_steps_check check (jsonb_typeof(steps) = 'array');

-- ---------- repeat: ticking a repeating task done sets up the next one ----------
-- the next due date: one step on from the due date (today if it had none), and never in the past
create or replace function public.task_next_due(base date, rpt text) returns date
language plpgsql stable as $$
declare
  k int := 0;
  nxt date := base;
begin
  loop
    k := k + 1;
    if rpt = 'weekdays' then
      nxt := nxt + 1;
      while extract(isodow from nxt) > 5 loop nxt := nxt + 1; end loop;
    else
      nxt := case rpt
               when 'daily' then base + k
               when 'weekly' then base + 7 * k
               when 'monthly' then (base + make_interval(months => k))::date
               when 'yearly' then (base + make_interval(years => k))::date
             end;
    end if;
    exit when nxt is null or nxt >= current_date or k > 5000;
  end loop;
  return nxt;
end $$;

create or replace function public.task_repeat() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base date;
  nxt date;
  nid uuid := gen_random_uuid();
begin
  if new.done and not old.done and new.repeat is not null and new.repeated_to is null then
    base := coalesce(new.due_date, current_date);
    nxt := public.task_next_due(base, new.repeat);
    if nxt is null then return new; end if;
    insert into tasks (id, title, notes, job_id, assigned_to, created_by, due_date, important, steps, remind_on, repeat)
    values (nid, new.title, new.notes, new.job_id, new.assigned_to, new.created_by, nxt, new.important,
            (select coalesce(jsonb_agg(s || jsonb_build_object('done', false)), '[]'::jsonb) from jsonb_array_elements(new.steps) s),
            case when new.remind_on is not null then new.remind_on + (nxt - base) end,
            new.repeat);
    new.repeated_to := nid;
  end if;
  return new;
end $$;
drop trigger if exists task_repeat on tasks;
create trigger task_repeat before update of done on tasks for each row execute function public.task_repeat();

-- ---------- the bell: the task itself (as 052) and its reminder ----------
create or replace function public.task_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  j jobs;
  setter text;
  head text;
begin
  if tg_op = 'DELETE' then
    update notifications set status = 'done' where source_table = 'tasks' and source_id = old.id and status <> 'done';
    return old;
  end if;
  t := new;
  if tg_op = 'UPDATE' and (t.title, t.notes, t.job_id, t.assigned_to, t.due_date, t.done, t.remind_on)
                          is not distinct from (old.title, old.notes, old.job_id, old.assigned_to, old.due_date, old.done, old.remind_on) then
    return new;
  end if;
  select * into j from jobs where id = t.job_id;
  select coalesce(nullif(full_name, ''), email) into setter from profiles where id = t.created_by;
  head := coalesce(j.job_no || ' ' || j.code || ': ', '') || t.title;

  -- someone else's reminders (given to another person): close them
  update notifications set status = 'done'
   where source_table = 'tasks' and source_id = t.id and kind in ('task', 'task_reminder') and status <> 'done' and profile_id is distinct from t.assigned_to;

  -- the reminder: done, cleared or moved closes it; a new date (today or later), or opening the task again, puts it back up
  if t.done or t.remind_on is null or tg_op = 'INSERT' or t.remind_on is distinct from old.remind_on or t.assigned_to is distinct from old.assigned_to or old.done then
    update notifications set status = 'done'
     where source_table = 'tasks' and source_id = t.id and kind = 'task_reminder' and status <> 'done';
    if not t.done and t.remind_on is not null and t.remind_on >= current_date then
      insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (t.assigned_to, t.job_id, 'task_reminder', 'Reminder: ' || head,
              concat_ws(' · ', 'Due ' || to_char(t.due_date, 'DD/MM/YYYY'), case when t.created_by is distinct from t.assigned_to then 'From ' || setter end, left(t.notes, 200)),
              t.remind_on, '/tasks?task=' || t.id, 'tasks', t.id);
    end if;
  else
    update notifications
       set title = 'Reminder: ' || head,
           detail = concat_ws(' · ', 'Due ' || to_char(t.due_date, 'DD/MM/YYYY'), case when t.created_by is distinct from t.assigned_to then 'From ' || setter end, left(t.notes, 200)),
           job_id = t.job_id
     where source_table = 'tasks' and source_id = t.id and kind = 'task_reminder' and status <> 'done';
  end if;

  if t.done then
    update notifications set status = 'done' where source_table = 'tasks' and source_id = t.id and kind = 'task' and status <> 'done';
    -- done by someone other than the setter: the setter hears
    if tg_op = 'UPDATE' and not old.done and t.created_by is not null and t.created_by is distinct from auth.uid() then
      insert into notifications (profile_id, job_id, kind, title, link, source_table, source_id)
      values (t.created_by, t.job_id, 'task_done',
              'Done: ' || t.title || coalesce(' (' || (select coalesce(nullif(full_name, ''), email) from profiles where id = t.assigned_to) || ')', ''),
              '/tasks?task=' || t.id, 'tasks', t.id);
    end if;
    return new;
  end if;
  if exists (select 1 from notifications where source_table = 'tasks' and source_id = t.id and kind = 'task' and profile_id = t.assigned_to and status <> 'done') then
    update notifications
       set title = head,
           detail = concat_ws(' · ', case when t.created_by is distinct from t.assigned_to then 'From ' || setter end, left(t.notes, 200)),
           due_date = t.due_date, job_id = t.job_id, link = '/tasks?task=' || t.id
     where source_table = 'tasks' and source_id = t.id and kind = 'task' and profile_id = t.assigned_to and status <> 'done';
  else
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (t.assigned_to, t.job_id, 'task', head,
            concat_ws(' · ', case when t.created_by is distinct from t.assigned_to then 'From ' || setter end, left(t.notes, 200)),
            t.due_date, '/tasks?task=' || t.id, 'tasks', t.id);
  end if;
  return new;
end $$;
drop trigger if exists task_changed on tasks;
create trigger task_changed after insert or update or delete on tasks for each row execute function public.task_changed();

-- bell links already there open the task itself
update notifications set link = '/tasks?task=' || source_id
 where source_table = 'tasks' and kind in ('task', 'task_done') and link = '/tasks' and source_id is not null;

-- a task reminder shows on its own day (not before), and counts as due that day, like an off-hire reminder
create or replace view notifications_live with (security_invoker = true) as
select n.id, n.profile_id, n.job_id, n.kind, n.title, n.detail, n.due_date, n.link, n.source_table, n.source_id, n.status, n.snoozed_until, n.created_at,
  case when n.due_date is null then 'info'::notif_severity
       when n.due_date < current_date then 'overdue'::notif_severity
       when n.due_date <= current_date + (case n.kind when 'valuation_due' then 7 when 'off_hire_due' then 0 when 'task_reminder' then 0 else 14 end) then 'due_soon'::notif_severity
       else 'info'::notif_severity end as severity
from notifications n
where (n.status = 'open' or (n.status = 'snoozed' and n.snoozed_until <= current_date))
  and (n.profile_id is null or n.profile_id = auth.uid())
  and not (n.kind = 'task_reminder' and n.due_date > current_date);
grant select on notifications_live to authenticated;

-- ---------- files on a task ----------
create table if not exists task_files (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references tasks(id) on delete cascade,
  path         text not null,                                   -- in storage "tasks": <task id>/<time>-<name>
  name         text not null,
  uploaded_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists task_files_task on task_files (task_id);

-- whoever can see the task (the person it's for, who set it, admins: the tasks rules apply inside these checks)
alter table task_files enable row level security;
drop policy if exists "task files: read" on task_files;
drop policy if exists "task files: add" on task_files;
drop policy if exists "task files: remove" on task_files;
create policy "task files: read" on task_files for select to authenticated using (exists (select 1 from tasks t where t.id = task_id));
create policy "task files: add" on task_files for insert to authenticated with check (uploaded_by = auth.uid() and exists (select 1 from tasks t where t.id = task_id));
create policy "task files: remove" on task_files for delete to authenticated using ((uploaded_by = auth.uid() or public.is_admin()) and exists (select 1 from tasks t where t.id = task_id));
-- archived jobs read-only (as 042)
drop policy if exists "archived job: no adding" on task_files;
drop policy if exists "archived job: no deleting" on task_files;
create policy "archived job: no adding" on task_files as restrictive for insert to authenticated
  with check (not exists (select 1 from tasks t where t.id = task_id and t.job_id is not null and public.job_archived(t.job_id)));
create policy "archived job: no deleting" on task_files as restrictive for delete to authenticated
  using (not exists (select 1 from tasks t where t.id = task_id and t.job_id is not null and public.job_archived(t.job_id)));
grant select, insert, delete on task_files to authenticated;

-- the files themselves (private: only through the app, for those who can see the task)
insert into storage.buckets (id, name, public) values ('tasks', 'tasks', false) on conflict (id) do nothing;
drop policy if exists "tasks: read" on storage.objects;
drop policy if exists "tasks: add" on storage.objects;
drop policy if exists "tasks: remove" on storage.objects;
create policy "tasks: read" on storage.objects for select to authenticated
  using (bucket_id = 'tasks' and exists (select 1 from public.tasks t where t.id::text = (storage.foldername(name))[1]));
create policy "tasks: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'tasks' and exists (select 1 from public.tasks t where t.id::text = (storage.foldername(name))[1]
              and (t.job_id is null or not public.job_archived(t.job_id))));
create policy "tasks: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'tasks' and exists (select 1 from public.task_files f where f.path = objects.name and (f.uploaded_by = auth.uid() or public.is_admin())));
