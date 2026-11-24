#!/usr/bin/env bash
# ビルド成果物とリポジトリに秘密情報が含まれていないかを確認する
set -euo pipefail
fail=0
if grep -rIl --exclude-dir=node_modules -E "service_role|SERVICE_ROLE_KEY=.+|VAPID_PRIVATE_KEY=.+" dist 2>/dev/null; then
  echo "NG: ビルド成果物に秘密鍵の可能性がある文字列が含まれています"; fail=1
fi
# Supabase の JWT 形式のキーがソースに直書きされていないか
if grep -rIl --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git -E "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}" . 2>/dev/null; then
  echo "NG: JWT 形式のキーがファイルに含まれています"; fail=1
fi
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "NG: .env がコミットされています"; fail=1
fi
[ $fail -eq 0 ] && echo "OK: 秘密情報は見つかりませんでした"
exit $fail
