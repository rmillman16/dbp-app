-- =====================================================================
-- 104 · Tasks: anyone @mentioned in a task can see it (27 Nov)
-- A task is for one person, but it can name others with @Name (in its title or notes). Everyone named now sees the task in their
-- Tasks list (marked "Mentioned", read only: they can't tick or change it) and gets a note on their bell. Their names are worked
-- out from the text by the database, so it works however the task was made or edited: the full name (@Ann Smith) or just a first
-- name (@Ann) when only one person has it. Run after 103. Safe to run again.
-- =====================================================================
alter table tasks add column if not exists mentioned uuid[] not null default '{}';

create or replace function public.task_set_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  txt text := lower(coalesce(new.title, '') || ' ' || coalesce(new.notes, '') || ' ');
begin
  new.mentioned := coalesce((
    select array_agg(p.id) from profiles p
     where p.id is distinct from new.assigned_to
       and p.id is distinct from new.created_by
       and nullif(trim(coalesce(p.full_name, '')), '') is not null
       and (
         position('@' || lower(trim(p.full_name)) in txt) > 0
         or (
           length(regexp_replace(lower(split_part(trim(p.full_name), ' ', 1)), '[^a-z0-9]', '', 'g')) >= 2
           and txt ~ ('@' || regexp_replace(lower(split_part(trim(p.full_name), ' ', 1)), '[^a-z0-9]', '', 'g') || '([^a-z0-9]|$)')
           and (select count(*) from profiles q where lower(split_part(trim(q.full_name), ' ', 1)) = lower(split_part(trim(p.full_name), ' ', 1))) = 1
         )
       )
  ), '{}');
  return new;
end $$;
drop trigger if exists task_set_mentions on tasks;
create trigger task_set_mentions before insert or update of title, notes, assigned_to on tasks
  for each row execute function public.task_set_mentions();

-- a note on the bell for each person newly named; it closes when the task is done, deleted, or they are no longer named
create or replace function public.task_mention_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who uuid;
  setter text;
  target text;
  j jobs;
begin
  select coalesce(nullif(full_name, ''), email) into setter from profiles where id = new.created_by;
  select coalesce(nullif(full_name, ''), email) into target from profiles where id = new.assigned_to;
  select * into j from jobs where id = new.job_id;
  if new.done then
    update notifications set status = 'done' where source_table = 'tasks' and source_id = new.id and kind = 'task_mention' and status <> 'done';
    return new;
  end if;
  foreach who in array new.mentioned loop
    if tg_op = 'INSERT' or not (who = any (old.mentioned)) then
      insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (who, new.job_id, 'task_mention',
              'Mentioned: ' || coalesce(j.job_no || ' ' || j.code || ': ', '') || new.title,
              concat_ws(' · ', 'From ' || coalesce(setter, 'a colleague'), case when new.assigned_to is distinct from who then 'for ' || coalesce(target, 'someone') end),
              new.due_date, '/tasks?task=' || new.id, 'tasks', new.id);
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    update notifications set status = 'done'
     where source_table = 'tasks' and source_id = new.id and kind = 'task_mention' and status <> 'done' and not (profile_id = any (new.mentioned));
  end if;
  return new;
end $$;
drop trigger if exists task_mention_notify on tasks;
create trigger task_mention_notify after insert or update of mentioned, done on tasks
  for each row execute function public.task_mention_notify();

-- who can see a task: it is for them, they set it, they are named in it, or they are an admin
drop policy if exists "tasks: read" on tasks;
create policy "tasks: read" on tasks for select to authenticated
  using (assigned_to = auth.uid() or created_by = auth.uid() or auth.uid() = any (mentioned) or public.is_admin());

-- tasks already made: work out who they name (open ones only; those people get their note now)
update tasks set title = title where not done;

notify pgrst, 'reload schema';
