-- =====================================================================
-- 069 · Submittal statuses A / B / C per document, proper revision names, and RFIs back in the assignee's court (24 Nov)
-- Richard:
--  - "if a reply has been made and the status of the RFI isn't closed then it's back in the assignee's court": any reply from
--    DBP staff to an answered RFI reopens it and tells the assignee, whichever type of reply was picked. (066 did this only for
--    a "follow-up"; a plain DBP reply left it saying "you have replied, with du Boulay Projects".)
--  - Submittals: the first issue is an "Initial issue", not "Rev A". After Status C (revise and resubmit) the next issue is
--    Rev A, Rev B...; after Status B (approved with comments) it is reissued as a "Construction issue".
--  - Each document on a submittal gets its own Status A (approved, no comments) / B (approved with comments) / C (revise and
--    resubmit). The submittal takes the worst of them.
-- Safe to run more than once. No existing data is lost (run after 068).
-- =====================================================================

-- ---------- submittals: revision names and a status per document ----------
alter table submittal_revisions add column if not exists rev_label text;   -- null = worked out: 1 is the Initial issue, then Rev A, Rev B...
alter table submittals          add column if not exists rev_label text;   -- the current revision's name, for the register
alter table submittal_files     add column if not exists outcome   text;
alter table submittal_files drop constraint if exists submittal_files_outcome_check;
alter table submittal_files add constraint submittal_files_outcome_check check (outcome is null or outcome in ('approved', 'approved_noted', 'revise', 'rejected'));

-- ---------- RFIs: any DBP reply to an answered RFI puts it back with the assignee ----------
create or replace function public.rfi_reply_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r rfis; p record; back boolean;
begin
  select * into r from rfis where id = new.rfi_id;

  -- DBP replying to the assignee's answer: a "follow-up", or a plain reply from a DBP person who is not themselves the assignee
  -- and is not just recording an answer on someone's behalf
  back := new.kind = 'follow_up'
       or (new.kind = 'reply' and r.status = 'answered' and new.author_id is not null
           and coalesce(new.author_name, '') not ilike '%recorded by%'
           and not exists (select 1 from rfi_people x where x.rfi_id = r.id and x.role = 'assignee' and x.profile_id = new.author_id));

  if back then
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
