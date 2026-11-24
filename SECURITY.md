# SECURITY / PRIVACY

金銭情報と生活記録は個人情報として扱います。

## 要件と対応

| 要件 | 対応 | 検証 |
|---|---|---|
| Row Level Security を必ず有効化 | `records` / `push_subscriptions` / `push_log` で `enable` + `force row level security` | `npm run test:sql` |
| 本人のデータのみ閲覧・編集 | 全ポリシーが `user_id = auth.uid()`。`lp_push` は `security invoker` で RLS の対象 | 他人の行の参照・更新・削除・挿入・所有者付け替えが失敗することをテスト |
| 他ユーザーへのアクセス防止 | 上記＋`anon` ロールの権限を剥奪。`push_log` は利用者から不可視 | 同上 |
| 管理者権限の秘密鍵をクライアントに含めない | クライアントは anon（公開）キーのみ。service_role は Edge Function のサーバー環境変数でのみ使用 | CI でビルド成果物に `service_role` 等が含まれないことを確認（`scripts/check-secrets.sh`） |
| HTTPS | Vercel / Supabase とも HTTPS。`Strict-Transport-Security` ヘッダー。Supabase URL は `https://` 以外を受け付けない | — |
| パスワードを独自に平文保存しない | 認証は Supabase Auth に委譲。アプリはパスワードを保存しない | コード確認 |
| 秘密情報をコミットしない | `.env` を `.gitignore`。`.env.example` は空の値のみ。cron SQL は値を入れずに保存 | — |
| 環境変数の管理 | `VITE_` で始まる公開してよい値のみクライアントへ。秘密は Vercel/Supabase の管理画面で設定 | — |
| 入力値の検証 | 金額は安全な整数・上限あり、日付・時刻の形式検証、文字数上限。バックアップ読み込み時は全レコードを型・範囲検証（`src/backup/validate.ts`）。サーバー側も CHECK 制約（テーブル名・ID長・JSON 形式・サイズ） | 単体テスト・SQL テスト |
| 個人情報をログに出さない | `console.log` で記録内容を出力しない。エラー表示にも入力内容を含めない | 単体テスト（エラーメッセージ） |
| アカウント削除・データ削除 | 設定 > 保存と同期 > アカウント削除（クラウド＋端末）。設定 > データの削除（端末） | SQL テスト（本人のみ削除・他人のデータは残る） |
| 解析・広告なし | 外部スクリプトなし。CSP で `script-src 'self'` | CSP 適用状態での動作確認 |
| 開発者向けの利用者監視なし | 該当機能なし | — |
| 外部AIへの無断送信なし | 外部への送信先は Supabase のみ（CSP の `connect-src` でも制限） | — |
| CSV インジェクション対策 | `= + - @` で始まるセルに `'` を付与 | 単体テスト |

## Content Security Policy（vercel.json）

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co; manifest-src 'self'; worker-src 'self';
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```
`style-src 'unsafe-inline'` は React の style 属性（進捗バーの幅など）のため。スクリプトのインライン実行は許可していません。

## 誰が何を見られるか（隠さずに説明）

| 立場 | 見られる範囲 |
|---|---|
| 同じ端末を使う人 | アプリを開ける状態なら、その端末に保存された記録（端末内データは暗号化していません） |
| 他の利用者 | 見られません（RLS） |
| Supabase 社・データベース管理者（運営者） | **技術的にはクラウド上の記録を閲覧できます**。記録はアプリ側で暗号化していません（E2E 暗号化ではない） |
| 通信経路 | HTTPS で暗号化 |
| Web Push 経路 | 通知本文は汎用の文言のみ（タスク名や金額は送らない） |

利用者向けの説明はアプリ内「設定 > プライバシーについて」にあります。

## 残るリスク・今後の検討

- 端末内データの暗号化（パスコードロック）は未実装。端末の画面ロックに依存します。
- エンドツーエンド暗号化は未実装（実装すると管理者も読めなくなる一方、パスワードを忘れると復元不能になるため、方針の決定が必要）。
- Supabase の「メール確認」「パスワード強度」「レート制限」は Supabase 側の設定に依存（DEPLOYMENT.md 参照）。
- 依存ライブラリの脆弱性は `npm audit` で定期確認してください。
