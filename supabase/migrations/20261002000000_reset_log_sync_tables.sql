-- Reset Log cloud sync: one settings row per user, one row per logged day.

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,                      -- { habits: [...], rules: [...] }
  updated_at timestamptz not null default now()
);

create table public.day_logs (
  user_id uuid not null references auth.users (id) on delete cascade,
  log_date date not null,
  data jsonb not null,                      -- { vals, rules, weight, waist, note }
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

alter table public.user_settings enable row level security;
alter table public.day_logs enable row level security;

-- Only signed-in users touch these tables, and only their own rows.
revoke all on public.user_settings from anon;
revoke all on public.day_logs from anon;
grant select, insert, update, delete on public.user_settings to authenticated;
grant select, insert, update, delete on public.day_logs to authenticated;

create policy "user_settings_select_own" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_settings_insert_own" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_settings_update_own" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_settings_delete_own" on public.user_settings
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "day_logs_select_own" on public.day_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "day_logs_insert_own" on public.day_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "day_logs_update_own" on public.day_logs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "day_logs_delete_own" on public.day_logs
  for delete to authenticated using ((select auth.uid()) = user_id);
