-- =====================================================================
-- 013 · EOT: delay events from VOs, notice reminders, days granted
-- Scope in docs/decisions.md ("EOT module"). 001 created delay_events,
-- eot_claims and eot_claim_events; this adds:
-- - jobs.eot_notice_days: how many days after an event the notice is due,
--   per the job's contract (left blank = no due date worked out)
-- - delay events: number (DE01…), details, days granted
-- - every VO with programme days becomes a delay event automatically and
--   follows its days; a draft event that isn't in a claim is removed if
--   the VO's days go back to 0 or the VO is rejected
-- - a bell reminder for each notice not yet sent, due on its notice date
-- - existing VOs with programme days get their delay events now
-- No existing data is lost.
-- =====================================================================

alter table jobs add column if not exists eot_notice_days int;
alter table delay_events add column if not exists event_no int;
alter table delay_events add column if not exists details text;
alter table delay_events add column if not exists days_granted numeric(6,1);
alter table eot_claims add column if not exists notes text;

-- ---------- VO programme days → delay events ----------
create or replace function public.vo_delay_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if coalesce(new.programme_days, 0) > 0 and new.status <> 'rejected' then
    if exists (select 1 from delay_events where variation_id = new.id) then
      update delay_events
         set days_claimed = new.programme_days,
             description  = 'VO ' || new.vo_no || ' – ' || new.title
       where variation_id = new.id and status in ('draft', 'notified');
    else
      d := coalesce(new.date_issued, new.vo_date, current_date);
      insert into delay_events (job_id, type, variation_id, description, event_date, days_claimed, event_no, notice_due)
      select new.job_id, 'variation', new.id, 'VO ' || new.vo_no || ' – ' || new.title, d, new.programme_days,
             coalesce((select max(event_no) from delay_events where job_id = new.job_id), 0) + 1,
             case when j.eot_notice_days is not null then d + j.eot_notice_days end
        from jobs j where j.id = new.job_id;
    end if;
  else
    delete from delay_events de
     where de.variation_id = new.id and de.status = 'draft'
       and not exists (select 1 from eot_claim_events ce where ce.event_id = de.id);
  end if;
  return new;
end $$;

drop trigger if exists vo_delay_event on variations;
create trigger vo_delay_event after insert or update of programme_days, status, title on variations
  for each row execute function public.vo_delay_event();

-- ---------- notice reminders on the bell ----------
create or replace function public.delay_event_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from notifications
   where source_table = 'delay_events' and kind = 'eot_notice' and status <> 'done'
     and source_id = case when tg_op = 'DELETE' then old.id else new.id end;
  if tg_op = 'DELETE' then return old; end if;
  if new.notice_due is not null and new.notice_sent is null and new.status not in ('rejected', 'granted') then
    insert into notifications (job_id, kind, title, detail, due_date, link, source_table, source_id)
    select new.job_id, 'eot_notice',
           j.job_no || ' ' || j.code || ' notice of delay due: DE' || lpad(coalesce(new.event_no, 0)::text, 2, '0'),
           new.description, new.notice_due, '/jobs/' || new.job_id || '/eot', 'delay_events', new.id
      from jobs j where j.id = new.job_id;
  end if;
  return new;
end $$;

drop trigger if exists delay_event_reminder on delay_events;
create trigger delay_event_reminder after insert or update of notice_due, notice_sent, status, description or delete on delay_events
  for each row execute function public.delay_event_reminder();

-- wording for the EOT claim letter (the notice of delay letter's wording came with 005)
insert into text_templates (key, title, category, sort, notes) values
 ('eot_claim_letter', 'Extension of time claim letter', 'EOT', 40,
  'Covering letter for an EOT claim. Placeholders: {{job}}, {{contract}}, {{days}}, {{completion}}, {{revised_completion}}. The table of delay events is added by the app. Notice periods and wording must follow the job''s contract.')
on conflict (key) do nothing;

-- existing VOs with programme days get their delay events now
update variations set programme_days = programme_days where coalesce(programme_days, 0) > 0;
