-- =====================================================================
-- 051 · Requisitions for my sites (23 Nov)
-- Richard: "change my requisitions to requisitions for my sites based on
-- sites I'm associated with". Someone on a job's Team (Overview › Team) can
-- now see every requisition on that job, not just the ones they raised:
-- its details, the questions and answers, and its attachments.
-- - only the person who raised it, or the buyer (Material / Hire Req -
--   ADMIN), can post in its conversation, so a team member's message is
--   never taken for a buyer's question
-- - changing a requisition stays with its requester and the buyer
-- Safe to run more than once. No existing data is lost.
-- =====================================================================

drop policy if exists "requisitions: read" on requisitions;
create policy "requisitions: read" on requisitions for select to authenticated
  using (
    requested_by = auth.uid()
    or public.has_access('buyer_' || kind)
    or exists (select 1 from job_team t where t.job_id = requisitions.job_id and t.profile_id = auth.uid())
  );

-- the conversation: readable with the requisition (unchanged); written only by the requester or the buyer
drop policy if exists "requisition messages: add" on requisition_messages;
create policy "requisition messages: add" on requisition_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from requisitions r
      where r.id = requisition_id and (r.requested_by = auth.uid() or public.has_access('buyer_' || r.kind))
    )
  );
