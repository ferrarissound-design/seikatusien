# DATABASE

## 端末内データベース（IndexedDB / Dexie）

DB 名：未ログイン `lifepartner-local`、ログイン中 `lifepartner-u-<userId>`

### 同期対象テーブル

すべてのレコードに共通：`id`（UUID または決定的ID）, `createdAt`, `updatedAt`（ISO8601）, `serverVersion`（端末専用・サーバー確認済み版）, `deleted`（0/1）

| テーブル | 主なフィールド |
|---|---|
| `checklists` | name, templateType, resetTime("HH:MM"/null), lastResetDate, sortOrder, showOnHome, isTemplate |
| `checkItems` | checklistId, label, checked, sortOrder |
| `checkHistory` | checklistId, checklistName, date, checkedCount, totalCount, items[], reason(reset/complete/manual)。ID は `h:<listId>:<date>` |
| `tasks` | title, notes, dueDate, dueTime, priority(1-3), category, done, doneAt, recurrence, carriedFrom, sortOrder, seriesId |
| `subtasks` | taskId, title, done, sortOrder |
| `transactions` | type(income/expense), amount（円の整数）, category, memo, date, fixedCostId, fixedCostPeriod("YYYY-MM") |
| `fixedCosts` | name, amount, dayOfMonth(1-31), category, active |
| `savingsGoals` | name, targetAmount, savedAmount |
| `reminders` | kind, label, time, weekdays[], targetId, enabled |
| `settings` | id='settings'。機能の表示、給料日、残高（balanceAmount + balanceAsOf）、予算、確保したい貯金、カテゴリー、表示設定 等 |

### 端末専用テーブル（同期しない）

| テーブル | 用途 |
|---|---|
| `outbox` | 未同期の変更キュー（opId, table, recordId, sentAt, baseVersion, payload, attempts, blocked） |
| `conflicts` | 同期競合の記録（端末側・サーバー側の内容を両方保存） |
| `meta` | 取得カーソル、最終同期日時、最終バックアップ日時、復元前スナップショット 等 |
| `notices` | アプリ内通知（30日で整理） |

### 金額の扱い
- すべて **円単位の整数**（`Number.isSafeInteger`）。上限 999,999,999 円。
- 入力は全角数字・カンマ・「円」を受け付け、整数以外は拒否。

### 残高の考え方
「残高を登録した時点の金額（balanceAmount, balanceAsOf）」を基準に、**それ以降に記録された** 収入・支出で増減します。
日付が未来の収入（未入金）・支出は、その日になるまで残高に含めません。

### スキーマ変更のルール（既存データを守るため）
1. 既存の `version(n)` の定義は書き換えない・削除しない。
2. 変更は `version(n+1)` を追加し、必要なら `.upgrade()` で移行する。
3. upgrade の中でデータを削除しない。変換できない値は既定値で補う。
4. `tests/unit/db-migration.test.ts` に移行テストを追加する。

現在のバージョン：**v2**（v1 → v2 で `reminders`・`notices` テーブルと `checklists.showOnHome` を追加。移行テスト済み）

## クラウドデータベース（Supabase / PostgreSQL）

構築 SQL：`supabase/migrations/20261124000000_init.sql` → `20261124000100_rls.sql` の順に実行（2回実行しても壊れない）。

### `public.records`

| 列 | 型 | 説明 |
|---|---|---|
| user_id | uuid | `auth.users(id)`。アカウント削除で連鎖削除 |
| table_name | text | 上記の同期対象テーブル名のみ許可（CHECK 制約） |
| id | text | レコードID（1〜200文字） |
| data | jsonb | レコード内容（オブジェクト、100KB まで） |
| version | int | 更新ごとに +1 |
| deleted | bool | 削除フラグ |
| rev | bigint | 取得カーソル用の単調増加番号（トリガーで採番） |
| last_op_id | uuid | 最後に適用した操作ID（再送の判別） |
| server_updated_at | timestamptz | サーバーでの更新時刻 |

主キー `(user_id, table_name, id)`、索引 `(user_id, rev)`。

### 関数

| 関数 | 説明 |
|---|---|
| `lp_push(ops jsonb)` | 同期の送信。版の一致確認・冪等な再送・1件ごとのエラー分離。`security invoker`（RLS が適用される） |
| `lp_delete_my_data()` | 自分のクラウドデータを削除 |
| `lp_delete_my_account()` | 自分のアカウントとデータを削除（`security definer`、`auth.uid()` の本人のみ） |

### その他のテーブル
- `push_subscriptions`：Web Push の購読情報（本人のみ読み書き可）
- `push_log`：送信済みリマインダー（サーバー専用。利用者からは読めない）

### 検証
`npm run test:sql` で、一時的な PostgreSQL に Supabase の `auth` を最小限再現して SQL と RLS を実行・検証します（`supabase/tests/rls_test.sql`）。
