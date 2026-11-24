-- =====================================================================
-- 078 · Project hub link and the welcome email (24 Nov)
-- 1. jobs.hub_url: ONE SharePoint link per job for outside people (drawings and project documents; the folders inside are managed
--    by Document Control). It goes at the foot of issued minutes and snag lists, in the footer of every email to an outside person,
--    and in the welcome email.
-- 2. welcome_outbox: whenever someone is added to a job's project directory, one welcome email is queued for them (the send-emails
--    Edge Function sends it, with the hub link, once the job has one). Only the server reads this table.
-- Safe to run more than once.
-- =====================================================================
alter table jobs add column if not exists hub_url text;

create table if not exists welcome_outbox (
  id           uuid primary key default gen_random_uuid(),
  directory_id uuid not null references job_directory(id) on delete cascade,
  job_id       uuid not null references jobs(id) on delete cascade,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  email        text                                       -- who it went to (one welcome per address per job)
);
create index if not exists welcome_outbox_pending on welcome_outbox (created_at) where sent_at is null;
alter table welcome_outbox enable row level security;   -- no policies: signed-in users can't read or change it
grant select, insert, update, delete on welcome_outbox to service_role;

create or replace function public.queue_welcome() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- a new entry on a job (or a tender's entries moving onto the job when it is won)
  if new.job_id is not null and (tg_op = 'INSERT' or old.job_id is null) then
    insert into welcome_outbox (directory_id, job_id) values (new.id, new.job_id);
  end if;
  return new;
end $$;
drop trigger if exists job_directory_welcome on job_directory;
create trigger job_directory_welcome after insert or update of job_id on job_directory for each row execute function public.queue_welcome();
