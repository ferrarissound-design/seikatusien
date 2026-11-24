import { getDb } from '../db/db';
import { getMeta, setMeta, getSettings } from '../db/repo';
import { uuid, nowIso } from '../lib/id';
import { dueReminders } from './reminders';
import { getSupabase } from '../sync/supabase';
import { syncStatus } from '../sync/manager';

/**
 * 通知の実装状況（正直に区別する）
 *  - アプリ内通知: 実装済み。起動時・画面表示中に、時刻を過ぎたリマインダーを表示。
 *  - 端末通知（アプリ表示中）: 実装済み。通知許可があれば Service Worker 経由で表示。
 *  - Web Push（アプリを閉じていても届く通知）: クライアント側の購読処理とサーバー関数のコードは用意。
 *    ただし VAPID 鍵・Supabase Edge Function のデプロイ・定期実行設定が必要で、
 *    クラウド開発環境では動作未検証。
 */

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied' | 'needs-install';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function notificationPermission(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    // iOS Safari のブラウザ表示では Notification API が無い（ホーム画面に追加すると使える）
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  return Notification.permission as PermissionState;
}

/** 利用者がボタンを押したときだけ呼ぶこと */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!('Notification' in window)) return notificationPermission();
  const r = await Notification.requestPermission();
  return r as PermissionState;
}

async function showDeviceNotification(title: string, body: string, tag: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag, icon: `${import.meta.env.BASE_URL}icons/icon-192.png`, badge: `${import.meta.env.BASE_URL}icons/icon-192.png` });
    else new Notification(title, { body, tag });
  } catch {
    /* 通知に失敗してもアプリ内通知は残る */
  }
}

/** リマインダーの時刻判定。起動時と1分ごとに呼ぶ。 */
export async function checkReminders(now: Date = new Date()) {
  const db = getDb();
  const lastIso = await getMeta<string>('reminderCheckedAt', db);
  // 初回は今日の0時から（当日中に過ぎたものだけ拾う）
  const since = lastIso ? new Date(lastIso) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  if (since > now) {
    await setMeta('reminderCheckedAt', now.toISOString(), db);
    return;
  }
  const [reminders, tasks, fixedCosts, settings] = await Promise.all([
    db.reminders.toArray(),
    db.tasks.toArray(),
    db.fixedCosts.toArray(),
    getSettings(db),
  ]);
  const notices = dueReminders(reminders, { tasks, fixedCosts, settings }, since, now);
  for (const n of notices) {
    const exists = await db.notices.where('key').equals(n.key).first();
    if (exists) continue;
    await db.notices.add({ id: uuid(), key: n.key, title: n.title, body: n.body, createdAt: nowIso(), read: 0 });
    if (document.visibilityState === 'visible') void showDeviceNotification(n.title, n.body, n.key);
  }
  await setMeta('reminderCheckedAt', now.toISOString(), db);
  // 古い通知は30日で整理
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
  await db.notices.filter((x) => x.createdAt < cutoff).delete();
}

// ---------------- Web Push（要サーバー設定・未検証） ----------------

const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const isWebPushConfigured = !!vapidKey;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Web Push を購読し、購読情報を Supabase に保存する。
 * ログイン済み・VAPID 鍵設定済み・通知許可済みが条件。
 */
export async function subscribeWebPush(): Promise<'ok' | 'not-configured' | 'not-logged-in' | 'no-permission' | 'unsupported' | 'error'> {
  if (!vapidKey) return 'not-configured';
  const sb = getSupabase();
  const uid = syncStatus.get().userId;
  if (!sb || !uid) return 'not-logged-in';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission !== 'granted') return 'no-permission';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }));
    const json = sub.toJSON();
    const settings = await getSettings();
    const { error } = await sb.from('push_subscriptions').upsert(
      {
        user_id: uid,
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        timezone: settings.timezone,
      },
      { onConflict: 'endpoint' },
    );
    return error ? 'error' : 'ok';
  } catch {
    return 'error';
  }
}

export async function unsubscribeWebPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const sb = getSupabase();
    if (sb) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  } catch {
    /* noop */
  }
}
