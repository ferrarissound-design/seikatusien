-- RLS・同期RPCの検証（架空のユーザーで実行）
-- 失敗すると例外で停止します。
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.invalid')
on conflict do nothing;

-- ===== Alice として操作 =====
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- 新規作成
do $$
declare r jsonb;
begin
  r := public.lp_push('[{"opId":"aaaaaaaa-0000-0000-0000-000000000001","table":"transactions","id":"tx1","baseVersion":0,"data":{"id":"tx1","amount":1000},"deleted":false}]');
  assert r->0->>'status' = 'ok', 'create should succeed: ' || r::text;
  assert (r->0->>'version')::int = 1, 'version 1';
end $$;

-- 同じ opId の再送は冪等（version が増えない）
do $$
declare r jsonb;
begin
  r := public.lp_push('[{"opId":"aaaaaaaa-0000-0000-0000-000000000001","table":"transactions","id":"tx1","baseVersion":0,"data":{"id":"tx1","amount":1000},"deleted":false}]');
  assert r->0->>'status' = 'ok', 'retry ok';
  assert (r->0->>'version')::int = 1, 'retry must not bump version: ' || r::text;
end $$;

-- 正しい baseVersion で更新
do $$
declare r jsonb;
begin
  r := public.lp_push('[{"opId":"aaaaaaaa-0000-0000-0000-000000000002","table":"transactions","id":"tx1","baseVersion":1,"data":{"id":"tx1","amount":1200},"deleted":false}]');
  assert r->0->>'status' = 'ok' and (r->0->>'version')::int = 2, 'update: ' || r::text;
end $$;

-- 古い baseVersion は競合として拒否され、上書きされない
do $$
declare r jsonb;
begin
  r := public.lp_push('[{"opId":"aaaaaaaa-0000-0000-0000-000000000003","table":"transactions","id":"tx1","baseVersion":1,"data":{"id":"tx1","amount":9999},"deleted":false}]');
  assert r->0->>'status' = 'conflict', 'stale should conflict: ' || r::text;
  assert (r->0->'server'->'data'->>'amount')::int = 1200, 'server data returned';
  assert (select (data->>'amount')::int from public.records where id = 'tx1') = 1200, 'not overwritten';
end $$;

-- 不正なテーブル名はその1件だけ拒否され、同じバッチの正しい操作は保存される
do $$
declare r jsonb;
begin
  r := public.lp_push('[{"opId":"aaaaaaaa-0000-0000-0000-000000000004","table":"evil","id":"x","baseVersion":0,"data":{},"deleted":false},{"opId":"aaaaaaaa-0000-0000-0000-000000000006","table":"tasks","id":"t-ok","baseVersion":0,"data":{"id":"t-ok"},"deleted":false}]');
  assert r->0->>'status' = 'rejected', 'invalid table rejected: ' || r::text;
  assert r->1->>'status' = 'ok', 'valid op in same batch saved: ' || r::text;
  assert (select count(*) from public.records where table_name = 'evil') = 0, 'nothing stored for evil';
end $$;

-- rev は単調増加
do $$
declare r1 bigint; r2 bigint;
begin
  perform public.lp_push('[{"opId":"aaaaaaaa-0000-0000-0000-000000000005","table":"tasks","id":"t1","baseVersion":0,"data":{"id":"t1"},"deleted":false}]');
  select rev into r1 from public.records where id = 'tx1';
  select rev into r2 from public.records where id = 't1';
  assert r2 > r1, 'rev increases';
end $$;

-- 他人の user_id で直接 insert はできない
do $$
begin
  begin
    insert into public.records (user_id, table_name, id, data) values ('22222222-2222-2222-2222-222222222222', 'tasks', 'hack', '{}');
    raise exception 'should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ===== Bob として操作 =====
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

do $$
declare r jsonb;
begin
  -- Alice の行は見えない
  assert (select count(*) from public.records) = 0, 'bob must not see alice rows';
  -- Alice の行は更新・削除できない（0件）
  update public.records set data = '{"hacked":true}' where id = 'tx1';
  delete from public.records where id = 'tx1';
  -- 同じ id でも Bob の空間に別レコードとして作られ、Alice のものには触れない
  r := public.lp_push('[{"opId":"bbbbbbbb-0000-0000-0000-000000000001","table":"transactions","id":"tx1","baseVersion":0,"data":{"id":"tx1","amount":1},"deleted":false}]');
  assert r->0->>'status' = 'ok' and (r->0->>'version')::int = 1, 'bob separate row: ' || r::text;
  assert (select count(*) from public.records) = 1, 'bob sees only own';
  -- push_log は利用者から読めない
  begin
    perform 1 from public.push_log;
    raise exception 'push_log should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 所有者の付け替えはできない
do $$
begin
  begin
    update public.records set user_id = '11111111-1111-1111-1111-111111111111' where id = 'tx1';
    raise exception 'should have failed';
  exception when insufficient_privilege or raise_exception then null;
  end;
end $$;

-- ===== 未ログイン（anon） =====
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  begin
    perform 1 from public.records;
    raise exception 'anon should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.lp_push('[]');
    raise exception 'anon should not execute';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ===== アカウント削除 =====
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.lp_delete_my_account();
reset role;
do $$
begin
  assert (select count(*) from public.records where user_id = '22222222-2222-2222-2222-222222222222') = 0, 'bob data deleted';
  assert (select count(*) from auth.users where id = '22222222-2222-2222-2222-222222222222') = 0, 'bob user deleted';
  assert (select (data->>'amount')::int from public.records where user_id = '11111111-1111-1111-1111-111111111111' and id = 'tx1') = 1200, 'alice data intact';
end $$;

select 'ALL RLS TESTS PASSED' as result;
