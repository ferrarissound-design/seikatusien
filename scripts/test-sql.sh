#!/usr/bin/env bash
# ローカルの PostgreSQL で Supabase 用 SQL と RLS を検証する（開発環境用）
# 使い方: bash scripts/test-sql.sh
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=$(mktemp -d)
PORT=${PGPORT_TEST:-55432}
cleanup() { "$PGBIN/pg_ctl" -D "$DIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
chown -R postgres "$DIR" 2>/dev/null || true
RUN="runuser -u postgres --"
if [ "$(id -u)" != "0" ]; then RUN=""; fi
$RUN "$PGBIN/initdb" -D "$DIR" -U postgres >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -w start >/dev/null
PSQL="$RUN psql -h $DIR -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# SQL は呼び出し側のシェルで読み、標準入力で渡す（postgres ユーザーが作業ディレクトリを読めない CI 環境に対応）
$PSQL < "$ROOT/supabase/tests/supabase_shim.sql"
# 2回実行して冪等性も確認
for i in 1 2; do
  $PSQL < "$ROOT/supabase/migrations/20261124000000_init.sql"
  $PSQL < "$ROOT/supabase/migrations/20261124000100_rls.sql"
done
$PSQL < "$ROOT/supabase/tests/rls_test.sql"
