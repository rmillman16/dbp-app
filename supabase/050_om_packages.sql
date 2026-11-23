-- =====================================================================
-- 050 · O&M: items by SoW package, received = has a link, removing for
-- admins and Operations (23 Nov)
-- Richard reviewed the O&M tab: "just the item and its contents"; items
-- grouped by the job's packages (SoW / procurement schedule) with a General
-- / packs section; a draft pack built from the SoW; anything can be removed
-- when it's not required; "admins and operations can remove items from O&M".
-- - om_requirements.package_id: the SoW package an item belongs to. Lines
--   made under an order get its package (the order's own, else the
--   procurement schedule row it's the order for). order_id / company_id stay
--   (client direct contractors, older lines)
-- - received = it has a SharePoint link: the status follows the link (set:
--   received; cleared: requested / not requested), so reminders, payment
--   notices and the PDF keep working. Lines already there are brought in
--   step
-- - removing an item marks it not required (kept, hidden, and the draft
--   pack doesn't add it back). Only admins and Operations can remove an item,
--   bring one back, delete one for good, or delete an entry from the
--   project items list (om_item_names). Everyone else who can open O&M can
--   still add items and links
-- - reminders: one per person per package (package and subcontractor) per
--   due date, instead of per order / company; client direct contractors and
--   General as before. Still updated in place, never deleted and re-made
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

-- ---------- items by package ----------
alter table om_requirements add column if not exists package_id uuid references packages(id) on delete set null;
create index if not exists om_requirements_package on om_requirements (package_id);

update om_requirements r set package_id = o.package_id
  from orders o
 where o.id = r.order_id and r.package_id is null and o.package_id is not null;
update om_requirements r set package_id = (
    select p.id from procurement_items pi
      join packages p on p.job_id = pi.job_id and (p.id = pi.package_id or p.name = pi.description)
     where pi.order_id = r.order_id and pi.section = 'contract'
     order by (p.id = pi.package_id) desc limit 1)
 where r.package_id is null and r.order_id is not null;

-- ---------- who can remove O&M items: admins and Operations ----------
create or replace function public.can_remove_om() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin or 'operations' = any(p.roles) or coalesce(p.is_operations, false)
                   from profiles p where p.id = auth.uid()), false)
$$;
grant execute on function public.can_remove_om() to authenticated;

drop policy if exists "remove: admins and operations" on om_requirements;
create policy "remove: admins and operations" on om_requirements as restrictive for delete to authenticated
  using (public.can_remove_om());

drop policy if exists "admins remove" on om_item_names;
drop policy if exists "admins and operations remove" on om_item_names;
create policy "admins and operations remove" on om_item_names for delete to authenticated using (public.can_remove_om());

-- ---------- the status follows the link; not required only by admins and Operations ----------
create or replace function public.om_requirements_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  was_removed boolean := tg_op = 'UPDATE' and old.status = 'not_required';
begin
  -- removing (not required) or bringing back: admins and Operations (the SQL editor / server: allowed)
  if (new.status = 'not_required') is distinct from coalesce(was_removed, false)
     and auth.uid() is not null and not public.can_remove_om() then
    raise exception 'Only admins and Operations can remove O&M items (or bring them back).';
  end if;
  -- received = it has a link
  if new.status <> 'not_required' and (tg_op = 'INSERT' or new.file_url is distinct from old.file_url or was_removed) then
    if nullif(trim(coalesce(new.file_url, '')), '') is not null then
      if new.status not in ('received', 'accepted') then new.status := 'received'; end if;
      new.received_date := coalesce(new.received_date, current_date);
    elsif new.status in ('received', 'accepted') then
      new.status := case when new.requested_date is not null then 'requested'::om_status else 'not_requested'::om_status end;
      new.received_date := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists om_requirements_rules on om_requirements;
create trigger om_requirements_rules before insert or update on om_requirements
  for each row execute function public.om_requirements_rules();

-- lines already there, in step with their links
update om_requirements set status = 'received', received_date = coalesce(received_date, current_date)
 where status in ('not_requested', 'requested', 'rejected_resubmit') and nullif(trim(coalesce(file_url, '')), '') is not null;
update om_requirements set status = case when requested_date is not null then 'requested'::om_status else 'not_requested'::om_status end, received_date = null
 where status in ('received', 'accepted') and nullif(trim(coalesce(file_url, '')), '') is null;

-- ---------- reminders: per package ----------
-- "Electrical (Acme Ltd)": the package (its procurement name), with its subcontractor when known
create or replace function public.om_package_label(pkg uuid) returns text
language sql stable security definer set search_path = public as $$
  with p as (select * from packages where id = pkg),
  pi as (
    select pi.* from procurement_items pi, p
     where pi.job_id = p.job_id and pi.section = 'contract' and (pi.package_id = p.id or pi.description = p.name)
     order by (pi.package_id = p.id) desc limit 1
  ),
  sub as (
    select coalesce(
      (select c.name from orders o join companies c on c.id = o.company_id where o.package_id = pkg order by o.folder_no nulls last limit 1),
      (select c.name from pi join orders o on o.id = pi.order_id join companies c on c.id = o.company_id),
      (select c.name from pi join companies c on c.id = pi.company_id)) as name
  )
  select coalesce((select nullif(display_name, '') from pi), (select name from p), 'Package')
         || coalesce(' (' || (select name from sub) || ')', '')
$$;

create or replace function public.refresh_om_reminders(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
  g record;
  p uuid;
  hit uuid;
  keep uuid[] := '{}';
  t text;
  d text;
begin
  select * into j from jobs where id = p_job;
  if j.id is null then return; end if;
  for g in
    with outstanding as (
      select r.package_id, r.order_id, r.company_id, r.due_date, r.sort, coalesce(r.custom_name, dt.name, 'Item') as doc_name
      from om_requirements r left join om_doc_types dt on dt.id = r.doc_type_id
      where r.job_id = p_job and r.due_date is not null
        and r.status in ('not_requested', 'requested', 'rejected_resubmit')
    )
    select coalesce(o.package_id, o.order_id, o.company_id) as group_id, o.due_date,
           case when min(o.package_id::text) is not null then public.om_package_label(min(o.package_id::text)::uuid)
                else coalesce(min(oc.name), min(cc.name), 'General') end as who,
           count(*) as n,
           string_agg(o.doc_name, ', ' order by o.sort, o.doc_name) as docs
    from outstanding o
    left join orders ord on ord.id = o.order_id and o.package_id is null
    left join companies oc on oc.id = ord.company_id
    left join companies cc on cc.id = o.company_id and o.order_id is null and o.package_id is null
    group by coalesce(o.package_id, o.order_id, o.company_id), o.due_date
  loop
    t := j.job_no || ' ' || j.code || ' O&Ms: ' || g.who || ': ' || g.n || case when g.n = 1 then ' item' else ' items' end
         || ' missing, due ' || to_char(g.due_date, 'DD/MM/YYYY');
    d := case when length(g.docs) > 240 then left(g.docs, 237) || '…' else g.docs end || '. Chase them from the O&M tab.';
    for p in select * from public.om_team(p_job) loop
      hit := null;
      select id into hit from notifications
       where kind = 'om_due' and job_id = p_job and profile_id = p and due_date = g.due_date
         and source_id is not distinct from g.group_id and (status <> 'done' or auto_closed)
       order by (status <> 'done') desc, created_at desc limit 1;
      if hit is not null then
        update notifications
           set title = t, detail = d, link = '/jobs/' || p_job || '/om', auto_closed = false,
               status = case when status = 'done' then 'open'::notif_status else status end
         where id = hit;
      elsif not exists (
        select 1 from notifications
         where kind = 'om_due' and job_id = p_job and profile_id = p and due_date = g.due_date and source_id is not distinct from g.group_id
      ) then
        insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
        values (p, p_job, 'om_due', t, d, g.due_date, '/jobs/' || p_job || '/om', 'om_requirements', g.group_id)
        returning id into hit;
      end if;
      -- (a reminder its person marked done while items are still missing: left done)
      if hit is not null then keep := keep || hit; end if;
    end loop;
  end loop;
  -- anything no longer missing (or for someone no longer on the team) closes
  update notifications set status = 'done', auto_closed = true
   where kind = 'om_due' and job_id = p_job and status <> 'done' and not (id = any(keep));
end $$;

-- every job's reminders, regrouped now
do $$
declare jid uuid;
begin
  for jid in select distinct job_id from om_requirements loop
    perform public.refresh_om_reminders(jid);
  end loop;
end $$;
