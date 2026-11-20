-- =====================================================================
-- 002 · CAR limit check: stop duplicate notifications
-- The 001 check added a new "over the CAR limit" notification every time
-- a job over the limit was saved, even when the contract sum hadn't
-- changed. This version only adds one when the sum actually changes and
-- the job doesn't already have an open or snoozed CAR notification.
-- Replaces the function only; no tables or data are changed.
-- =====================================================================

create or replace function public.flag_car_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare car numeric;
begin
  if tg_op = 'UPDATE' and new.contract_sum is not distinct from old.contract_sum then
    return new;
  end if;

  select limit_amount into car from company_insurances
   where cover = 'Contractors all risks' and end_date >= current_date order by end_date desc limit 1;

  if car is not null and new.contract_sum > car
     and not exists (select 1 from notifications
                      where job_id = new.id and kind = 'car_limit' and status in ('open','snoozed')) then
    insert into notifications (job_id, kind, title, detail, due_date, source_table, source_id)
    values (new.id, 'car_limit',
            new.job_no || ' ' || new.code || ' is over the £' || to_char(car,'FM9,999,999') || ' CAR limit',
            'Contract sum £' || to_char(new.contract_sum,'FM999,999,999') || ': extend cover before starting',
            current_date, 'jobs', new.id);
  end if;
  return new;
end $$;
