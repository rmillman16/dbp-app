-- =====================================================================
-- 033 · Requisitions: notify instantly (22 Nov: "make it notify instantly")
-- - the bell updates the moment a reminder is added (Supabase Realtime on
--   notifications; who sees which reminder is unchanged)
-- - a buyer's question (or the requester's answer) is due today, so it shows
--   on the bell straight away rather than waiting for its date
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

-- a message on a requisition:
-- - from anyone but the requester (the buyer): a question. The requisition goes to "query" and the requester
--   gets a reminder (due today), on the bell and the job's To do
-- - from the requester: an answer. Their question reminders close, it goes to "answered", and whoever asked
--   last gets a reminder
create or replace function public.requisition_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r requisitions;
  j jobs;
  ref text;
  asker uuid;
begin
  select * into r from requisitions where id = new.requisition_id;
  select * into j from jobs where id = r.job_id;
  ref := case r.kind when 'hire' then 'HR' else 'MR' end || lpad(r.req_no::text, 4, '0');
  if new.author_id is distinct from r.requested_by then
    update requisitions set status = 'query', buyer_id = coalesce(buyer_id, new.author_id) where id = r.id and status in ('new', 'answered', 'query');
    if r.requested_by is not null then
      insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (r.requested_by, r.job_id, 'requisition_query',
              coalesce(j.job_no || ' ' || j.code || ' ', '') || ref || ': question on ' || r.element,
              left(new.body, 300), current_date, '/site/requisitions/' || r.id, 'requisitions', r.id);
    end if;
  else
    update notifications set status = 'done'
     where source_table = 'requisitions' and source_id = r.id and kind = 'requisition_query' and profile_id = r.requested_by and status <> 'done';
    update requisitions set status = 'answered' where id = r.id and status = 'query';
    select author_id into asker from requisition_messages
     where requisition_id = r.id and author_id is distinct from r.requested_by order by created_at desc limit 1;
    if asker is not null then
      insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
      values (asker, r.job_id, 'requisition_answer',
              coalesce(j.job_no || ' ' || j.code || ' ', '') || ref || ': answered (' || r.element || ')',
              left(new.body, 300), current_date, '/site/requisitions/' || r.id, 'requisitions', r.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists requisition_message on requisition_messages;
create trigger requisition_message after insert on requisition_messages for each row execute function public.requisition_message();
