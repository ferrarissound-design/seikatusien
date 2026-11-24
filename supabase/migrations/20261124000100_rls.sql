-- =====================================================================
-- Life Partner: Row Level Security 設定
-- 20261124000000_init.sql の実行後に実行してください。
-- 利用者は自分（auth.uid()）の行だけを読み書きできます。
-- =====================================================================

alter table public.records enable row level security;
alter table public.records force row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
alter table public.push_log enable row level security;
alter table public.push_log force row level security;

-- 匿名ユーザーには一切の権限を与えない
revoke all on public.records from anon;
revoke all on public.push_subscriptions from anon;
revoke all on public.push_log from anon;

grant select, insert, update, delete on public.records to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant usage, select on sequence public.records_rev_seq to authenticated;
-- push_log はサーバー（Edge Function / service_role）専用。利用者からは読み書き不可。
revoke all on public.push_log from authenticated;

-- records
drop policy if exists records_select_own on public.records;
drop policy if exists records_insert_own on public.records;
drop policy if exists records_update_own on public.records;
drop policy if exists records_delete_own on public.records;

create policy records_select_own on public.records
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy records_insert_own on public.records
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy records_update_own on public.records
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy records_delete_own on public.records
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- push_subscriptions
drop policy if exists push_select_own on public.push_subscriptions;
drop policy if exists push_insert_own on public.push_subscriptions;
drop policy if exists push_update_own on public.push_subscriptions;
drop policy if exists push_delete_own on public.push_subscriptions;

create policy push_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_insert_own on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy push_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
