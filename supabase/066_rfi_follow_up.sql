-- =====================================================================
-- 066 · An RFI goes back and forth: DBP's reply to an answer re-opens it and tells the assignee (23 Nov)
-- Richard: "if a reply is made, the original assignee should be notified again of the reply and the RFI should go back into
-- unanswered". So when DBP replies to the assignee's answer (a follow-up in the thread):
-- - the RFI goes from Answered back to Open (unanswered), so it is chased again
-- - the assignees are told: DBP assignees on the bell (and email); outside assignees get an email with their private link,
--   queued in rfi_outbox as a "follow_up"
-- - the chase clock starts again from the reply
-- An assignee's answer still moves it to Answered and tells the RFI manager (057).
-- Safe to run more than once. No existing data is lost (run after 065).
-- =====================================================================
alter table rfi_outbox drop constraint if exists rfi_outbox_kind_check;
alter table rfi_outbox add constraint rfi_outbox_kind_check check (kind in ('new', 'chase', 'follow_up'));

create or replace function public.rfi_reply_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r rfis; p record;
begin
  select * into r from rfis where id = new.rfi_id;

  if new.kind = 'follow_up' then
    -- DBP replies to the answer: back to the assignees, and the RFI is unanswered again
    if r.status = 'answered' then
      update rfis set status = 'open', last_chased_at = now() where id = r.id;
    end if;
    for p in select * from rfi_people where rfi_id = r.id and role = 'assignee' loop
      if p.profile_id is not null and p.profile_id is distinct from new.author_id then
        insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
        values (p.profile_id, r.job_id, 'rfi_followup', public.rfi_label(r) || ' RFI ' || r.number || ' has a reply for you: ' || r.title,
                coalesce(new.author_name, 'DBP') || ' replied to your answer. It is open again.', r.due_date, public.rfi_link(r), 'rfis', r.id);
      elsif p.directory_id is not null and r.notify then
        insert into rfi_outbox (rfi_id, person_id, kind) values (r.id, p.id, 'follow_up');
      end if;
    end loop;
    return new;
  end if;

  -- an answer from anyone but the manager: the RFI is Answered and the manager is told (as before)
  if new.kind = 'reply' and r.status = 'open' and new.author_id is distinct from r.manager_id then
    update rfis set status = 'answered' where id = r.id;
  end if;
  if r.manager_id is not null and new.author_id is distinct from r.manager_id and new.kind <> 'note' then
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (r.manager_id, r.job_id, 'rfi_answered', public.rfi_label(r) || ' RFI ' || r.number || ' has a reply: ' || r.title,
            coalesce(new.author_name, 'Someone') || ' replied. Review it, then close the RFI.', null, public.rfi_link(r), 'rfis', r.id);
  end if;
  return new;
end $$;
