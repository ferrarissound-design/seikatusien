-- =====================================================================
-- Life Partner: Supabase データベース構築 SQL
-- Supabase ダッシュボード > SQL Editor に貼り付けて実行してください。
-- 何度実行しても壊れないよう、可能な限り冪等に書いています。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 同期レコード表
--    アプリの各データ（タスク・支出など）を 1 行 1 レコードで保存します。
--    data は端末側のレコード内容（JSON）です。
-- ---------------------------------------------------------------------
create sequence if not exists public.records_rev_seq;

create table if not exists public.records (
  user_id            uuid        not null references auth.users (id) on delete cascade,
  table_name         text        not null,
  id                 text        not null,
  data               jsonb       not null,
  version            integer     not null default 1,
  deleted            boolean     not null default false,
  rev                bigint      not null default nextval('public.records_rev_seq'),
  last_op_id         uuid,
  server_updated_at  timestamptz not null default now(),
  primary key (user_id, table_name, id),
  constraint records_table_name_chk check (table_name in (
    'checklists','checkItems','checkHistory','tasks','subtasks',
    'transactions','fixedCosts','savingsGoals','reminders','settings'
  )),
  constraint records_id_chk check (char_length(id) between 1 and 200),
  constraint records_data_obj_chk check (jsonb_typeof(data) = 'object'),
  constraint records_data_size_chk check (pg_column_size(data) <= 100000),
  constraint records_version_chk check (version >= 1)
);

create index if not exists records_user_rev_idx on public.records (user_id, rev);

-- rev（取得カーソル）と更新時刻は常にサーバー側で採番する
create or replace function public.lp_records_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.rev := nextval('public.records_rev_seq');
  new.server_updated_at := now();
  if tg_op = 'UPDATE' then
    -- 所有者の付け替えを禁止
    if new.user_id <> old.user_id then
      raise exception 'user_id cannot be changed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists records_touch on public.records;
create trigger records_touch
before insert or update on public.records
for each row execute function public.lp_records_touch();

-- ---------------------------------------------------------------------
-- 2. 同期の送信処理（RPC）
--    - baseVersion がサーバー版と一致する場合のみ更新（競合検知）
--    - 同じ opId の再送は二重適用せず成功を返す（冪等）
--    - 利用者ごとに直列化し、rev の取得順序の逆転を防ぐ
--    security invoker のため、RLS がそのまま適用されます。
-- ---------------------------------------------------------------------
create or replace function public.lp_push(ops jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  op       jsonb;
  cur      public.records%rowtype;
  results  jsonb := '[]'::jsonb;
  v_op_id  uuid;
  v_base   integer;
  v_table  text;
  v_id     text;
  v_ver    integer;
  v_rev    bigint;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(ops) <> 'array' then
    raise exception 'ops must be an array';
  end if;
  if jsonb_array_length(ops) > 100 then
    raise exception 'too many ops';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  for op in select value from jsonb_array_elements(ops) loop
    v_op_id := (op->>'opId')::uuid;
    v_base  := coalesce((op->>'baseVersion')::integer, 0);
    v_table := op->>'table';
    v_id    := op->>'id';

    if jsonb_typeof(op->'data') <> 'object' or v_table is null or v_id is null then
      results := results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', 'invalid op');
      continue;
    end if;

    -- 1件ごとにサブトランザクションで処理し、不正な1件が全体を止めないようにする
    begin
    select * into cur from public.records
      where user_id = uid and table_name = v_table and id = v_id
      for update;

    if found then
      if cur.last_op_id = v_op_id then
        results := results || jsonb_build_object('opId', v_op_id, 'status', 'ok', 'version', cur.version, 'rev', cur.rev);
        continue;
      end if;
      if cur.version <> v_base then
        results := results || jsonb_build_object(
          'opId', v_op_id, 'status', 'conflict',
          'server', jsonb_build_object(
            'table_name', cur.table_name, 'id', cur.id, 'data', cur.data,
            'version', cur.version, 'deleted', cur.deleted, 'rev', cur.rev));
        continue;
      end if;
      update public.records
         set data = op->'data',
             deleted = coalesce((op->>'deleted')::boolean, false),
             version = cur.version + 1,
             last_op_id = v_op_id
       where user_id = uid and table_name = v_table and id = v_id
       returning version, rev into v_ver, v_rev;
    else
      insert into public.records (user_id, table_name, id, data, deleted, version, last_op_id)
      values (uid, v_table, v_id, op->'data', coalesce((op->>'deleted')::boolean, false), 1, v_op_id)
      returning version, rev into v_ver, v_rev;
    end if;

    results := results || jsonb_build_object('opId', v_op_id, 'status', 'ok', 'version', v_ver, 'rev', v_rev);
    exception when others then
      results := results || jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'reason', sqlstate);
    end;
  end loop;

  return results;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Web Push 購読情報（任意機能）
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  timezone    text not null default 'Asia/Tokyo',
  created_at  timestamptz not null default now(),
  constraint push_endpoint_chk check (endpoint like 'https://%' and char_length(endpoint) < 2000)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- 送信済みリマインダーの記録（同じ通知を二重送信しない）
create table if not exists public.push_log (
  user_id   uuid not null references auth.users (id) on delete cascade,
  key       text not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------
-- 4. アカウント削除（本人のみ）
--    auth.users を削除すると records / push_subscriptions も連鎖削除されます。
-- ---------------------------------------------------------------------
create or replace function public.lp_delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.records where user_id = uid;
  delete from public.push_subscriptions where user_id = uid;
  delete from public.push_log where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

-- クラウド上のデータだけを削除（アカウントは残す）
create or replace function public.lp_delete_my_data()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.records where user_id = auth.uid();
end;
$$;

revoke all on function public.lp_delete_my_account() from public, anon;
grant execute on function public.lp_delete_my_account() to authenticated;
revoke all on function public.lp_delete_my_data() from public, anon;
grant execute on function public.lp_delete_my_data() to authenticated;
revoke all on function public.lp_push(jsonb) from public, anon;
grant execute on function public.lp_push(jsonb) to authenticated;
