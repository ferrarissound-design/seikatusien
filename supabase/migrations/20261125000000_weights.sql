-- =====================================================================
-- Life Partner: 体重の記録（weights）を同期できるようにする
-- 20261124000000_init.sql / 20261124000100_rls.sql の後に実行してください。
-- 何度実行しても壊れません。RLS は records 表の既存ポリシーがそのまま適用されます。
-- ※ アプリを体重機能つきの版に更新する「前」に実行してください。
--   未実行のまま体重を記録すると、その記録はクラウドに送れず端末に残ります
--   （SQL 実行後、自動で送信されます）。
-- =====================================================================
alter table public.records drop constraint if exists records_table_name_chk;
alter table public.records add constraint records_table_name_chk check (table_name in (
  'checklists','checkItems','checkHistory','tasks','subtasks',
  'transactions','fixedCosts','savingsGoals','reminders','settings',
  'weights'
));
