-- RouteLog Supabase setup
-- 1) すぐ試す場合: Authentication > Providers > Anonymous Sign-Ins を有効化
-- 2) PC/スマホで同じクラウドを使う場合: Google Providerも有効化
-- 3) SQL Editor でこのSQLを1回実行

create table if not exists public.routelog_data (
  user_id uuid not null,
  key text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.routelog_data enable row level security;

drop policy if exists "routelog_select_own" on public.routelog_data;
create policy "routelog_select_own"
on public.routelog_data for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "routelog_insert_own" on public.routelog_data;
create policy "routelog_insert_own"
on public.routelog_data for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "routelog_update_own" on public.routelog_data;
create policy "routelog_update_own"
on public.routelog_data for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "routelog_delete_own" on public.routelog_data;
create policy "routelog_delete_own"
on public.routelog_data for delete
to authenticated
using (auth.uid() = user_id);
