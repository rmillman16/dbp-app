-- =====================================================================
-- 089 · Suggestions and issues (25 Nov)
-- Settings › Suggestions and issues: admins log an idea or something wrong in the app, with photos
-- (screenshots), and keep track of it (new, planned, done, won't do). Admins only: nobody else can see or add.
-- Photos go in a private storage area "suggestions". Safe to run again.
-- =====================================================================
create table if not exists app_suggestions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'issue' check (kind in ('issue', 'idea')),
  title       text not null,
  details     text,
  page        text,                                        -- where in the app, e.g. "Orders › Payment notice"
  status      text not null default 'new' check (status in ('new', 'planned', 'done', 'declined')),
  note        text,                                        -- what was decided or done
  created_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists app_suggestion_files (
  id             uuid primary key default gen_random_uuid(),
  suggestion_id  uuid not null references app_suggestions(id) on delete cascade,
  name           text not null,
  path           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists app_suggestion_files_s on app_suggestion_files (suggestion_id);
drop trigger if exists t_app_suggestions_upd on app_suggestions;
create trigger t_app_suggestions_upd before update on app_suggestions for each row execute function set_updated_at();

alter table app_suggestions enable row level security;
alter table app_suggestion_files enable row level security;
drop policy if exists "admins only" on app_suggestions;
drop policy if exists "admins only" on app_suggestion_files;
create policy "admins only" on app_suggestions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins only" on app_suggestion_files for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public) values ('suggestions', 'suggestions', false) on conflict (id) do nothing;
drop policy if exists "suggestions: read" on storage.objects;
drop policy if exists "suggestions: add" on storage.objects;
drop policy if exists "suggestions: remove" on storage.objects;
create policy "suggestions: read" on storage.objects for select to authenticated using (bucket_id = 'suggestions' and public.is_admin());
create policy "suggestions: add" on storage.objects for insert to authenticated with check (bucket_id = 'suggestions' and public.is_admin());
create policy "suggestions: remove" on storage.objects for delete to authenticated using (bucket_id = 'suggestions' and public.is_admin());
