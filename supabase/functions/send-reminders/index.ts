// Supabase Edge Function: send-reminders
// ---------------------------------------------------------------
// 状態: 実装済み・【未検証】（クラウド開発環境では Supabase / Apple Push に接続できないため）
//
// 5分ごとに呼び出され（DEPLOYMENT.md の pg_cron 設定を参照）、
// 利用者が設定したリマインダーの時刻を迎えたものを Web Push で送信する。
//
// 必要なシークレット（Supabase ダッシュボード > Edge Functions > Secrets）:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (例: mailto:you@example.com)
//   CRON_SECRET（呼び出し元の確認用。任意の長い文字列）
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で設定する。
//
// プライバシー: 通知本文にはタスク名や金額を含めず、汎用の文言のみ送る。
// ---------------------------------------------------------------
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const WINDOW_MIN = 5;

const MESSAGES: Record<string, { title: string; body: string }> = {
  checklist: { title: '忘れ物チェック', body: '出かける前に持ち物を確認しましょう' },
  taskDue: { title: '今日のタスク', body: '今日やることを確認しましょう' },
  recurringTask: { title: 'いつものタスク', body: '今日のいつものタスクがあります' },
  payment: { title: '支払い予定', body: '支払い予定を確認しましょう' },
  payday: { title: '給料日', body: '入金を確認したら残高を更新しましょう' },
  expenseLog: { title: '支出の記録', body: '今日使ったお金をメモしておきましょう' },
};

function localParts(now: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: wd };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: subs, error } = await sb.from('push_subscriptions').select('endpoint,user_id,p256dh,auth,timezone');
  if (error) return new Response('db error', { status: 500 });

  const now = new Date();
  let sent = 0;
  const byUser = new Map<string, typeof subs>();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  for (const [userId, userSubs] of byUser) {
    const tz = userSubs[0].timezone || 'Asia/Tokyo';
    const lp = localParts(now, tz);
    const { data: rows } = await sb
      .from('records')
      .select('id,data')
      .eq('user_id', userId)
      .eq('table_name', 'reminders')
      .eq('deleted', false);
    for (const r of rows ?? []) {
      const d = r.data as { time?: string; enabled?: number; weekdays?: number[]; kind?: string };
      if (!d.enabled || !d.time) continue;
      if (Array.isArray(d.weekdays) && d.weekdays.length && !d.weekdays.includes(lp.weekday)) continue;
      const [h, m] = d.time.split(':').map(Number);
      const t = h * 60 + m;
      if (!(t <= lp.minutes && t > lp.minutes - WINDOW_MIN)) continue;
      const key = `${r.id}:${lp.date}`;
      const { error: logErr } = await sb.from('push_log').insert({ user_id: userId, key });
      if (logErr) continue; // 既に送信済み（主キー重複）
      const msg = MESSAGES[d.kind ?? ''] ?? { title: 'Life Partner', body: 'お知らせがあります' };
      for (const s of userSubs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...msg, tag: key, url: '/#/home' }));
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        }
      }
    }
  }
  // 古い送信記録を整理
  await sb.from('push_log').delete().lt('sent_at', new Date(now.getTime() - 7 * 86400000).toISOString());
  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
});
