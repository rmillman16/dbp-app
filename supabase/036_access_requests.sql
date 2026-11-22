-- =====================================================================
-- 036 · Access requests to IT (22 Nov)
-- Richard: the "no access" screen has a Request access button that sends IT
-- a request; the app will be managed by IT through an admin account.
-- - profiles.is_it: marks the admin login(s) IT uses. Admins tick it in
--   Settings › Users (only on admins)
-- - access_requests: who asked for which area, and what became of it
-- - a request puts a reminder on IT's bell (every IT login; all admins if
--   nobody is marked IT yet). Done / declined tells the person who asked
-- No existing data is lost.
-- =====================================================================

alter table profiles add column if not exists is_it boolean not null default false;

create or replace function public.set_it(person uuid, on_off boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change who is IT.'; end if;
  update profiles set is_it = on_off and is_admin where id = person;
end $$;
grant execute on function public.set_it(uuid, boolean) to authenticated;

create table if not exists access_requests (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade default auth.uid(),
  area         text not null,          -- what they were trying to open, e.g. "Estimating"
  path         text,                   -- the page's address
  note         text,                   -- why they need it (optional)
  status       text not null default 'open' check (status in ('open', 'done', 'declined')),
  handled_by   uuid references profiles(id),
  handled_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists access_requests_open on access_requests (status, created_at);
alter table access_requests enable row level security;
drop policy if exists "access requests: read" on access_requests;
drop policy if exists "access requests: ask" on access_requests;
drop policy if exists "access requests: handle" on access_requests;
create policy "access requests: read" on access_requests for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy "access requests: ask" on access_requests for insert to authenticated with check (profile_id = auth.uid());
create policy "access requests: handle" on access_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on access_requests to authenticated;

-- a new request: a reminder on IT's bell (all admins if nobody is marked IT)
create or replace function public.access_request_new() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  select coalesce(nullif(full_name, ''), email) into who from profiles where id = new.profile_id;
  insert into notifications (profile_id, kind, title, detail, due_date, link, source_table, source_id)
  select p.id, 'access_request', 'Access request: ' || coalesce(who, 'someone') || ' → ' || new.area,
         new.note, current_date, '/settings#access-requests', 'access_requests', new.id
  from profiles p
  where p.is_admin and (p.is_it or not exists (select 1 from profiles where is_admin and is_it));
  return new;
end $$;
drop trigger if exists access_request_new on access_requests;
create trigger access_request_new after insert on access_requests for each row execute function public.access_request_new();

-- dealt with: IT's reminders close and the person who asked hears
create or replace function public.access_request_handled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = old.status or new.status = 'open' then return new; end if;
  update notifications set status = 'done' where source_table = 'access_requests' and source_id = new.id and status <> 'done';
  insert into notifications (profile_id, kind, title, link, source_table, source_id)
  values (new.profile_id, 'access_request_reply',
          case when new.status = 'done' then 'Access to ' || new.area || ': sorted. Refresh the app to see it.'
               else 'Access to ' || new.area || ': not given. Ask IT if you need to know more.' end,
          new.path, 'access_requests', new.id);
  return new;
end $$;
drop trigger if exists access_request_handled on access_requests;
create trigger access_request_handled after update of status on access_requests for each row execute function public.access_request_handled();
