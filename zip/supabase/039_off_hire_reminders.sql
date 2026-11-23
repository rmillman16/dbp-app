-- =====================================================================
-- 039 · Hire: off-hired status and off-hire reminders to the ops team (22 Nov)
-- Richard: "a list of on hire items or an ability to filter but it should
-- send a notification to all ops team members 3 days before hire period is
-- up which should show up in their TODO lists".
-- - a new requisition status "off_hired" (hire only)
-- - the ops team: everyone whose profile type can open the hire buyer's list
--   (Settings › Access); if nobody can, the admins
-- - a hire that's ordered / on hire with an end date: each of the ops team
--   gets a reminder dated 3 days before it ends (on their bell and the job's
--   To do from that day). Changing the end date moves it; off-hired / voided
--   closes it
-- - the requester's update says "voided" rather than "cancelled"
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

alter table requisitions drop constraint if exists requisitions_status_check;
alter table requisitions add constraint requisitions_status_check
  check (status in ('new', 'query', 'answered', 'ordered', 'delivered', 'off_hired', 'cancelled'));

-- an off-hire reminder shows from its own date (3 days before the hire ends), not 14 days earlier
create or replace view notifications_live with (security_invoker = true) as
select n.*,
  case when n.due_date is null then 'info'::notif_severity
       when n.due_date < current_date then 'overdue'::notif_severity
       when n.due_date <= current_date + (case n.kind when 'valuation_due' then 7 when 'off_hire_due' then 0 else 14 end) then 'due_soon'::notif_severity
       else 'info'::notif_severity end as severity
from notifications n
where (n.status = 'open' or (n.status = 'snoozed' and n.snoozed_until <= current_date))
  and (n.profile_id is null or n.profile_id = auth.uid());

-- the ops team for hire
create or replace function public.hire_team() returns setof uuid
language sql stable security definer set search_path = public as $$
  with team as (
    select p.id from profiles p
    where exists (select 1 from role_access a where a.role = any(p.roles) and a.section = 'buyer_hire')
  )
  select id from team
  union
  select id from profiles where is_admin and not exists (select 1 from team)
$$;

-- the off-hire reminders for one hire requisition, as it stands now
create or replace function public.refresh_off_hire(r requisitions) returns void
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
  ends date;
begin
  update notifications set status = 'done'
   where source_table = 'requisitions' and source_id = r.id and kind = 'off_hire_due' and status <> 'done';
  ends := nullif(r.data->>'hire_end', '')::date;
  if r.kind = 'hire' and r.status in ('ordered', 'delivered') and ends is not null then
    select * into j from jobs where id = r.job_id;
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    select t, r.job_id, 'off_hire_due',
           coalesce(j.job_no || ' ' || j.code || ' ', '') || 'HR' || lpad(r.req_no::text, 4, '0') || ': hire ends ' || to_char(ends, 'DD/MM/YYYY') || ' (' || r.element || ')',
           'Off-hire it with the hire company, or extend it and change the end date.',
           ends - 3, '/site/requisitions/' || r.id, 'requisitions', r.id
    from public.hire_team() t;
  end if;
end $$;

create or replace function public.requisition_off_hire() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'hire' then return new; end if;
  if tg_op = 'UPDATE' and new.status = old.status and (new.data->>'hire_end') is not distinct from (old.data->>'hire_end') then return new; end if;
  perform public.refresh_off_hire(new);
  return new;
end $$;
drop trigger if exists requisition_off_hire on requisitions;
create trigger requisition_off_hire after insert or update of status, data on requisitions for each row execute function public.requisition_off_hire();

-- hires already on with an end date get their reminders now
do $$
declare r requisitions;
begin
  for r in select * from requisitions where kind = 'hire' and status in ('ordered', 'delivered') and nullif(data->>'hire_end', '') is not null loop
    perform public.refresh_off_hire(r);
  end loop;
end $$;

-- ordered / delivered (on hire) / voided: the requester hears; the question reminders close
create or replace function public.requisition_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
  ref text;
  word text;
begin
  if new.status = old.status then return new; end if;
  select * into j from jobs where id = new.job_id;
  ref := case new.kind when 'hire' then 'HR' else 'MR' end || lpad(new.req_no::text, 4, '0');
  if new.status in ('ordered', 'delivered', 'cancelled', 'off_hired') then
    update notifications set status = 'done'
     where source_table = 'requisitions' and source_id = new.id and kind in ('requisition_answer', 'requisition_query') and status <> 'done';
  end if;
  if new.status in ('ordered', 'delivered', 'cancelled') and new.requested_by is not null then
    word := case new.status when 'cancelled' then 'voided' when 'delivered' then case when new.kind = 'hire' then 'on hire' else 'delivered' end else new.status end;
    insert into notifications (profile_id, job_id, kind, title, detail, link, source_table, source_id)
    values (new.requested_by, new.job_id, 'requisition_update',
            coalesce(j.job_no || ' ' || j.code || ' ', '') || ref || ' ' || word || ': ' || new.element,
            case when new.status = 'ordered' and new.delivery_date is not null then case when new.kind = 'hire' then 'On site ' else 'Delivery ' end || to_char(new.delivery_date, 'DD/MM/YYYY') else null end,
            '/site/requisitions/' || new.id, 'requisitions', new.id);
  end if;
  return new;
end $$;
