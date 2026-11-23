-- =====================================================================
-- 010 · Monthly valuation reminders on every live job
-- One notification per month the job runs: "2611 FISL valuation:
-- November 2026", due one week before month end (moved back to the
-- Friday if that falls at a weekend). From the start date (or today) to
-- the PC date, or 12 months ahead if there's no PC date yet. Rebuilt
-- automatically when a job's status, start or PC date changes; reminders
-- already marked done are kept. Links to the job's Applications tab.
-- Also creates them now for the jobs already in the app.
-- =====================================================================

create or replace function public.refresh_valuation_reminders(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  j        jobs;
  m        date;
  last_m   date;
  month_end date;
  d        date;
begin
  select * into j from jobs where id = p_job;
  -- clear future reminders not yet dealt with; done ones stay as a record
  delete from notifications
   where job_id = p_job and kind = 'valuation_due' and status <> 'done' and due_date >= current_date;
  if j.id is null or j.status <> 'live' then return; end if;

  m      := date_trunc('month', greatest(coalesce(j.start_date, current_date), current_date))::date;
  last_m := date_trunc('month', coalesce(j.pc_date, (current_date + interval '12 months')::date))::date;
  while m <= last_m loop
    month_end := (m + interval '1 month - 1 day')::date;
    d := month_end - 7;
    if extract(isodow from d) = 6 then d := d - 1;      -- Saturday → Friday
    elsif extract(isodow from d) = 7 then d := d - 2;   -- Sunday → Friday
    end if;
    if d >= current_date and not exists (
         select 1 from notifications where job_id = p_job and kind = 'valuation_due' and due_date = d) then
      insert into notifications (job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (p_job, 'valuation_due',
              j.job_no || ' ' || j.code || ' valuation: ' || to_char(m, 'FMMonth YYYY'),
              'Prepare the client application for month end (' || to_char(month_end, 'DD/MM/YYYY') || ')',
              d, '/jobs/' || p_job || '/applications', 'jobs', p_job);
    end if;
    m := (m + interval '1 month')::date;
  end loop;
end $$;

create or replace function public.jobs_valuation_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_valuation_reminders(new.id);
  return new;
end $$;

drop trigger if exists jobs_valuation_reminders on jobs;
create trigger jobs_valuation_reminders after insert or update of status, start_date, pc_date, job_no, code on jobs
  for each row execute function public.jobs_valuation_reminders();

-- the jobs already in the app
select public.refresh_valuation_reminders(id) from jobs;
