-- =====================================================================
-- 041 · Notification emails (22 Nov)
-- Richard: "code the automatic emails and I'll sort the IT side". The first
-- exception to "the app only drafts emails": short notices that something's
-- waiting in the app, with a link (no attachments, prices or documents),
-- sent from DBP's Microsoft 365 mailbox by the send-emails Edge Function.
-- - notifications.emailed_at: when its email went (null = not yet / never)
-- - profiles.email_notifications: each person can turn the emails off
--   (My details); on by default
-- - a new requisition now notifies the ops team for its kind (whoever can
--   open Material Req - ADMIN / Hire Req - ADMIN; the admins if nobody can),
--   on the bell and by email. It closes once the buyer moves it on from New
-- No existing data is lost; nothing already on the bell gets emailed.
-- =====================================================================

alter table notifications add column if not exists emailed_at timestamptz;
create index if not exists notifications_to_email on notifications (created_at) where emailed_at is null and profile_id is not null;
-- everything already there counts as dealt with, so turning emails on doesn't send a backlog
update notifications set emailed_at = now() where emailed_at is null;

alter table profiles add column if not exists email_notifications boolean not null default true;
grant update (full_name, initials, job_title, email_notifications) on profiles to authenticated;

-- the ops team for a back end ('buyer_material' / 'buyer_hire'); the admins if nobody's type can open it
create or replace function public.req_team(part text) returns setof uuid
language sql stable security definer set search_path = public as $$
  with team as (
    select p.id from profiles p
    where exists (select 1 from role_access a where a.role = any(p.roles) and a.section = part)
  )
  select id from team
  union
  select id from profiles where is_admin and not exists (select 1 from team)
$$;

-- a new requisition: the ops team hear; once it's moved on from New, those notices close
create or replace function public.requisition_new() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
begin
  if tg_op = 'INSERT' then
    select * into j from jobs where id = new.job_id;
    insert into notifications (profile_id, job_id, kind, title, detail, link, source_table, source_id)
    select t, new.job_id, 'requisition_new',
           coalesce(j.job_no || ' ' || j.code || ' ', '') || case new.kind when 'hire' then 'HR' else 'MR' end || lpad(new.req_no::text, 4, '0')
             || ': new ' || new.kind || ' requisition (' || new.element || ')',
           coalesce(new.requester_name, 'Someone') || ' needs it ' || case new.kind when 'hire' then 'on hire from ' else 'by ' end || to_char(new.required_by, 'DD/MM/YYYY'),
           '/site/requisitions/' || new.id, 'requisitions', new.id
    from public.req_team('buyer_' || new.kind) t
    where t is distinct from new.requested_by;
  elsif new.status <> old.status and old.status = 'new' then
    update notifications set status = 'done'
     where source_table = 'requisitions' and source_id = new.id and kind = 'requisition_new' and status <> 'done';
  end if;
  return new;
end $$;
drop trigger if exists requisition_new on requisitions;
create trigger requisition_new after insert or update of status on requisitions for each row execute function public.requisition_new();
