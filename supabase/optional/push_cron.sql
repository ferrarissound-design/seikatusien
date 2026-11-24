-- =====================================================================
-- 任意: Web Push リマインダーの定期実行（5分ごと） 【未検証】
-- 事前に Edge Function "send-reminders" をデプロイし、シークレットを設定してください。
-- Supabase ダッシュボード > Database > Extensions で pg_cron と pg_net を有効にしてから実行します。
-- <PROJECT_REF> と <CRON_SECRET> を自分の値に置き換えてください。
-- CRON_SECRET は GitHub にコミットしないでください（この SQL は値を入れずに保存）。
-- =====================================================================
select cron.schedule(
  'lp-send-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- 停止する場合:
-- select cron.unschedule('lp-send-reminders');
