-- =====================================================================
-- 011 · Valuation reminders: only in the last week of the month
-- Agreed 20 Nov: a valuation reminder is noise until a week before
-- month end. The reminder is now due ON month end and only shows
-- (amber) from 7 days before; it turns red if month end passes without
-- being marked Done. Other reminders keep their 14-day "due soon" window.
-- Rebuilds the valuation reminders for every job. No other data changes.
-- =====================================================================

-- "due soon" window: 7 days for valuation reminders, 14 days for everything else
create or replace view notifications_live with (security_invoker = true) as
select n.*,
  case when n.due_date is null then 'info'::notif_severity
       when n.due_date < current_date then 'overdue'::notif_severity
       when n.due_date <= current_date + (case when n.kind = 'valuation_due' then 7 else 14 end) then 'due_soon'::notif_severity
       else 'info'::notif_severity end as severity
from notifications n
where n.status = 'open' or (n.status = 'snoozed' and n.snoozed_until <= current_date);

create or replace function public.refresh_valuation_reminders(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  j         jobs;
  m         date;
  last_m    date;
  month_end date;
begin
  select * into j from jobs where id = p_job;
  -- clear reminders not yet dealt with (including any from 010 dated a week early); done ones stay
  delete from notifications
   where job_id = p_job and kind = 'valuation_due' and status <> 'done'
     and due_date >= date_trunc('month', current_date)::date;
  if j.id is null or j.status <> 'live' then return; end if;

  m      := date_trunc('month', greatest(coalesce(j.start_date, current_date), current_date))::date;
  last_m := date_trunc('month', coalesce(j.pc_date, (current_date + interval '12 months')::date))::date;
  while m <= last_m loop
    month_end := (m + interval '1 month - 1 day')::date;
    if month_end >= current_date and not exists (
         select 1 from notifications where job_id = p_job and kind = 'valuation_due' and due_date = month_end) then
      insert into notifications (job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (p_job, 'valuation_due',
              j.job_no || ' ' || j.code || ' valuation: ' || to_char(m, 'FMMonth YYYY'),
              'Prepare and submit the client application by month end',
              month_end, '/jobs/' || p_job || '/applications', 'jobs', p_job);
    end if;
    m := (m + interval '1 month')::date;
  end loop;
end $$;

select public.refresh_valuation_reminders(id) from jobs;
