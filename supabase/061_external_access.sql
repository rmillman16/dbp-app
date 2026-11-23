-- =====================================================================
-- 061 · Outside access to RFIs and submittals (23 Nov)
-- Subcontractors, consultants and the client answer RFIs and review submittals WITHOUT a login or a Microsoft account, and
-- with no way into the rest of the app. How (docs/decisions.md):
-- - they are NOT users of the app: no Supabase login, no database access. They only talk to one Edge Function ("external"),
--   which checks who they are and hands back just their own item
-- - a private link per item per person (https://<app>/r/<token>): the token is random, only its hash is stored, it expires,
--   and DBP can revoke it. DBP can copy one from the RFI / submittal page (works before email is set up) and the platform's
--   emails carry them
-- - an email-code page (/external): they enter their email, get a 6-digit code, then see everything addressed to them
-- - an assignee / reviewer can reply or respond; Cc can only read. DBP closes RFIs; a submittal's reviewer sets the outcome
-- - every table here has row security on and NO policies: nobody but the server (service role) can read them directly
-- - a response from outside tells the manager on the bell
-- Safe to run more than once. No existing data is lost (run after 060).
-- =====================================================================

-- ---------- private links ----------
create table if not exists external_links (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('rfi', 'submittal')),
  item_id      uuid not null,                       -- the RFI or submittal
  person_id    uuid not null,                       -- its rfi_people / submittal_people row
  email        text,                                -- who it was made for (as at the time)
  token_hash   text not null unique,                -- sha256 of the token (the token itself is never stored)
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '90 days',
  revoked_at   timestamptz,
  last_used_at timestamptz,
  use_count    int not null default 0
);
create index if not exists external_links_item on external_links (kind, item_id);

-- email-code sign-in: a short-lived code, then a session
create table if not exists external_codes (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  code_hash  text not null,
  attempts   int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index if not exists external_codes_email on external_codes (email, created_at desc);
create table if not exists external_sessions (
  token_hash text primary key,
  email      text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
-- rate limiting (code requests, wrong codes, link guesses)
create table if not exists external_attempts (
  id   bigserial primary key,
  kind text not null,
  key  text not null,
  at   timestamptz not null default now()
);
create index if not exists external_attempts_k on external_attempts (kind, key, at desc);
-- what outside people did (shown to DBP: "last opened", replies)
create table if not exists external_events (
  id        bigserial primary key,
  link_id   uuid references external_links(id) on delete set null,
  email     text,
  action    text not null,
  item_kind text,
  item_id   uuid,
  ip_hash   text,
  at        timestamptz not null default now()
);
create index if not exists external_events_item on external_events (item_kind, item_id, at desc);

-- row security on, no policies: only the server (service role) reaches these. DBP staff may read link status (not tokens).
alter table external_links enable row level security;
alter table external_codes enable row level security;
alter table external_sessions enable row level security;
alter table external_attempts enable row level security;
alter table external_events enable row level security;
revoke all on external_codes, external_sessions, external_attempts from anon, authenticated;
revoke all on external_links, external_events from anon, authenticated;
grant select (id, kind, item_id, person_id, email, created_at, expires_at, revoked_at, last_used_at, use_count) on external_links to authenticated;
grant select on external_events to authenticated;
drop policy if exists "staff see link status" on external_links;
create policy "staff see link status" on external_links for select to authenticated using (public.has_access('job_rfis'));
drop policy if exists "staff see events" on external_events;
create policy "staff see events" on external_events for select to authenticated using (public.has_access('job_rfis'));

-- ---------- making and revoking links ----------
-- The internal one (server only): a fresh token for one person on one item. Returns the token (shown once).
create or replace function public.external_make_link(p_kind text, p_item uuid, p_person uuid, p_email text, p_by uuid, p_days int default 90)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  tok := translate(encode(gen_random_bytes(32), 'base64'), '+/=' || chr(10), '-_');
  insert into external_links (kind, item_id, person_id, email, token_hash, created_by, expires_at)
  values (p_kind, p_item, p_person, lower(nullif(btrim(p_email), '')), encode(digest(tok, 'sha256'), 'hex'), p_by, now() + make_interval(days => p_days));
  return tok;
end $$;
revoke execute on function public.external_make_link(text, uuid, uuid, text, uuid, int) from public, anon, authenticated;
grant execute on function public.external_make_link(text, uuid, uuid, text, uuid, int) to service_role;

-- DBP staff: a link for one of the outside people on an RFI / submittal (copy it into your own email)
create or replace function public.issue_external_link(p_kind text, p_person uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare item uuid; mail text;
begin
  if not public.has_access('job_rfis') then raise exception 'No access.'; end if;
  if p_kind = 'rfi' then
    select rfi_id into item from rfi_people where id = p_person and directory_id is not null;
  elsif p_kind = 'submittal' then
    select submittal_id into item from submittal_people where id = p_person and directory_id is not null;
  else
    raise exception 'Unknown kind.';
  end if;
  if item is null then raise exception 'That person is not an outside person on this item.'; end if;
  select coalesce(nullif(c.email, ''), nullif(co.email, '')) into mail
    from (select directory_id from rfi_people where id = p_person and p_kind = 'rfi'
          union all select directory_id from submittal_people where id = p_person and p_kind = 'submittal') pp
    join job_directory d on d.id = pp.directory_id
    left join contacts c on c.id = d.contact_id
    left join companies co on co.id = d.company_id;
  return public.external_make_link(p_kind, item, p_person, mail, auth.uid());
end $$;
grant execute on function public.issue_external_link(text, uuid) to authenticated;

create or replace function public.revoke_external_links(p_kind text, p_person uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_access('job_rfis') then raise exception 'No access.'; end if;
  update external_links set revoked_at = now() where kind = p_kind and person_id = p_person and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.revoke_external_links(text, uuid) to authenticated;

-- housekeeping: old codes, sessions and attempts are cleared whenever a new code is made (done by the function); this is for manual use
create or replace function public.external_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from external_codes where expires_at < now() - interval '1 day';
  delete from external_sessions where expires_at < now();
  delete from external_attempts where at < now() - interval '2 days';
$$;
revoke execute on function public.external_cleanup() from public, anon, authenticated;
grant execute on function public.external_cleanup() to service_role;

-- ---------- bigger files, and a note to the manager when a submittal is answered ----------
update storage.buckets set file_size_limit = 52428800 where id in ('rfis', 'submittals');   -- 50 MB

create or replace function public.submittal_response_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s submittals;
begin
  if new.outcome is null or old.outcome is not distinct from new.outcome then return new; end if;
  select * into s from submittals where id = new.submittal_id;
  -- told unless the manager recorded it themselves in the app
  if s.manager_id is not null and s.manager_id is distinct from auth.uid() then
    insert into notifications (profile_id, job_id, kind, title, detail, due_date, link, source_table, source_id)
    values (s.manager_id, s.job_id, 'submittal_response',
            public.submittal_label(s) || ' Submittal ' || s.number || ' Rev ' || chr(64 + new.rev) || ' responded: ' || case new.outcome when 'approved' then 'Approved' when 'approved_noted' then 'Approved as noted' when 'revise' then 'Revise and resubmit' else 'Rejected' end,
            coalesce(new.responded_by, 'The reviewer') || ' responded to ' || s.title || '.', null, '/jobs/' || s.job_id || '/submittals/' || s.id, 'submittals', s.id);
  end if;
  return new;
end $$;
drop trigger if exists submittal_response_notify on submittal_revisions;
create trigger submittal_response_notify after update of outcome on submittal_revisions for each row execute function public.submittal_response_notify();
