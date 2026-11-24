-- =====================================================================
-- 080 · Site usage tracking (24 Nov)
-- Records which part of the app each signed-in person opens (a page view: the area and tab, e.g. jobs / rfis; ids are removed, nothing
-- typed or stored in the app is recorded), so Settings › Usage can show what is used most, by whom, and when. People can only add
-- their own rows; only admins can read them (through the three functions below). Safe to run more than once.
-- =====================================================================
create table if not exists usage_events (
  id         bigint generated always as identity primary key,
  profile_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  area       text not null,                       -- jobs, site, estimating, settings ...
  tab        text not null default '',            -- inside a job: rfis, snagging, programme ... (empty elsewhere)
  path       text not null,                       -- the page with ids removed, e.g. /jobs/:id/rfis/:id
  created_at timestamptz not null default now()
);
create index if not exists usage_events_when on usage_events (created_at);
create index if not exists usage_events_who on usage_events (profile_id, created_at);
alter table usage_events enable row level security;
grant select, insert on usage_events to authenticated;
grant usage, select on sequence usage_events_id_seq to authenticated;
drop policy if exists "add my own" on usage_events;
create policy "add my own" on usage_events for insert to authenticated with check (profile_id = auth.uid());
drop policy if exists "admins read" on usage_events;
create policy "admins read" on usage_events for select to authenticated using (public.is_admin());

-- usage by area and tab
create or replace function public.usage_by_area(p_days int default 30)
returns table (area text, tab text, views bigint, people bigint, last_used timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
    select e.area, e.tab, count(*), count(distinct e.profile_id), max(e.created_at)
    from usage_events e where e.created_at >= now() - make_interval(days => greatest(p_days, 1))
    group by e.area, e.tab order by count(*) desc;
end $$;
grant execute on function public.usage_by_area(int) to authenticated;

-- usage by person
create or replace function public.usage_by_person(p_days int default 30)
returns table (profile_id uuid, full_name text, email text, views bigint, days_active bigint, last_seen timestamptz, top_area text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
    select p.id, p.full_name::text, p.email::text, count(*), count(distinct e.created_at::date), max(e.created_at),
           (select (e2.area || case when e2.tab <> '' then ' › ' || e2.tab else '' end) from usage_events e2
             where e2.profile_id = p.id and e2.created_at >= now() - make_interval(days => greatest(p_days, 1))
             group by e2.area, e2.tab order by count(*) desc limit 1)
    from usage_events e join profiles p on p.id = e.profile_id
    where e.created_at >= now() - make_interval(days => greatest(p_days, 1))
    group by p.id, p.full_name, p.email order by count(*) desc;
end $$;
grant execute on function public.usage_by_person(int) to authenticated;

-- usage by day
create or replace function public.usage_by_day(p_days int default 30)
returns table (day date, views bigint, people bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
    select e.created_at::date, count(*), count(distinct e.profile_id)
    from usage_events e where e.created_at >= now() - make_interval(days => greatest(p_days, 1))
    group by e.created_at::date order by e.created_at::date;
end $$;
grant execute on function public.usage_by_day(int) to authenticated;
