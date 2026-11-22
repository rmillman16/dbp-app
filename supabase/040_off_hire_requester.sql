-- =====================================================================
-- 040 · Off-hire reminders also go to whoever raised the hire (22 Nov)
-- Richard: "if you hired the item you should also be reminded 3 days before
-- it's up". The person who raised the hire requisition now gets the same
-- reminder as the ops team (once, even if they're in the ops team too), on
-- their bell and the job's To do. Hires already on get it now.
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

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
           case when t = r.requested_by then 'Your hire ends in 3 days. If you still need it, ask the buyer to extend it.'
                else 'Off-hire it with the hire company, or extend it and change the end date.' end,
           ends - 3, '/site/requisitions/' || r.id, 'requisitions', r.id
    from (select * from public.hire_team() union select r.requested_by where r.requested_by is not null) as team(t);
  end if;
end $$;

-- hires already on with an end date: reminders again, now including whoever raised them
do $$
declare r requisitions;
begin
  for r in select * from requisitions where kind = 'hire' and status in ('ordered', 'delivered') and nullif(data->>'hire_end', '') is not null loop
    perform public.refresh_off_hire(r);
  end loop;
end $$;
