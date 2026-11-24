import type { Session, SupabaseClient } from '@supabase/supabase-js';
import Dexie from 'dexie';
import { getDb, setActiveDb, LOCAL_DB_NAME, userDbName, LifePartnerDB } from '../db/db';
import { enqueueAll, getMeta, setMeta } from '../db/repo';
import { SYNC_TABLES } from '../db/types';
import { subscribe } from '../lib/events';
import { createStore } from '../lib/store';
import { SyncEngine, pendingCount } from './engine';
import { getSupabase, isCloudConfigured, SupabaseTransport } from './supabase';

export type SyncState = 'local' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  configured: boolean;
  state: SyncState;
  userId: string | null;
  email: string | null;
  lastSyncAt: string | null;
  pending: number;
  conflicts: number;
  error: string | null;
  /** ローカルモードのデータをアカウントに引き継ぐか確認が必要 */
  migrationOffer: boolean;
}

export const syncStatus = createStore<SyncStatus>({
  configured: isCloudConfigured,
  state: 'local',
  userId: null,
  email: null,
  lastSyncAt: null,
  pending: 0,
  conflicts: 0,
  error: null,
  migrationOffer: false,
});

const ACTIVE_USER_KEY = 'lp.activeUser';

let engine: SyncEngine | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 0;
let started = false;

/** 起動直後に、前回のアカウントのDBを開く（認証の確認を待たずに表示するため） */
export function openInitialDb(): LifePartnerDB {
  let uid: string | null = null;
  try {
    uid = isCloudConfigured ? localStorage.getItem(ACTIVE_USER_KEY) : null;
  } catch {
    uid = null;
  }
  return setActiveDb(uid ? userDbName(uid) : LOCAL_DB_NAME);
}

async function refreshCounts() {
  const db = getDb();
  try {
    const [pending, conflicts, lastSyncAt, err] = await Promise.all([
      pendingCount(db),
      db.conflicts.where('status').equals('pending').count(),
      getMeta<string>('lastSyncAt', db),
      getMeta<string | null>('lastSyncError', db),
    ]);
    syncStatus.set({ pending, conflicts, lastSyncAt: lastSyncAt ?? null, error: err ?? null });
  } catch {
    /* DB切替中など */
  }
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

export async function syncNow(): Promise<void> {
  if (!engine) {
    await refreshCounts();
    return;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    syncStatus.set({ state: 'offline' });
    await refreshCounts();
    return;
  }
  syncStatus.set({ state: 'syncing' });
  const r = await engine.sync();
  await refreshCounts();
  if (r.error) {
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : 15_000, 5 * 60_000);
    syncStatus.set({ state: navigator.onLine ? 'error' : 'offline', error: r.error });
    schedule(backoffMs);
  } else {
    backoffMs = 0;
    syncStatus.set({ state: 'idle', error: null });
    schedule(60_000);
  }
}

async function activateUser(session: Session | null) {
  const sb = getSupabase();
  if (!sb) return;
  const uid = session?.user.id ?? null;
  const prevUid = syncStatus.get().userId;
  if (uid === prevUid && engine) return;

  if (!uid) {
    engine = null;
    try {
      localStorage.removeItem(ACTIVE_USER_KEY);
    } catch {
      /* noop */
    }
    setActiveDb(LOCAL_DB_NAME);
    syncStatus.set({ state: 'local', userId: null, email: null, migrationOffer: false });
    await refreshCounts();
    return;
  }

  try {
    localStorage.setItem(ACTIVE_USER_KEY, uid);
  } catch {
    /* noop */
  }
  const db = setActiveDb(userDbName(uid));
  engine = new SyncEngine(db, new SupabaseTransport(sb));
  syncStatus.set({ userId: uid, email: session?.user.email ?? null, state: 'idle' });

  // ローカルモードで使っていたデータがあり、まだ引き継ぎを確認していなければ提案
  const asked = await getMeta<boolean>('migrationAsked', db);
  if (!asked && (await hasLocalModeData())) syncStatus.set({ migrationOffer: true });

  await syncNow();
}

async function hasLocalModeData(): Promise<boolean> {
  if (!(await Dexie.exists(LOCAL_DB_NAME))) return false;
  const local = new LifePartnerDB(LOCAL_DB_NAME);
  try {
    for (const t of SYNC_TABLES) {
      if (t === 'settings') continue;
      if ((await local.table(t).count()) > 0) return true;
    }
    return false;
  } finally {
    local.close();
  }
}

/**
 * ローカルモードのデータをアカウントへ引き継ぐ。
 * コピー → アウトボックス登録 → （成功後）ローカルモードのDBを空にする。
 * 同じIDのレコードは上書きせず、アカウント側を優先する（重複防止）。
 */
export async function acceptMigration(move: boolean) {
  const db = getDb();
  if (move) {
    const local = new LifePartnerDB(LOCAL_DB_NAME);
    try {
      await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async () => {
        for (const t of SYNC_TABLES) {
          const rows = await local.table(t).toArray();
          for (const r of rows) {
            const exists = await db.table(t).get(r.id);
            if (exists && t !== 'settings') continue;
            if (exists && t === 'settings') {
              // アカウント側に設定が無いか初期値のままなら、端末の設定を使う
              if (exists.serverVersion > 0 && exists.onboardingDone) continue;
            }
            await db.table(t).put({ ...r, serverVersion: exists?.serverVersion ?? 0 });
          }
        }
      });
      await enqueueAll(db);
      // コピーが完了してからローカルモード側を削除
      await local.delete();
    } finally {
      local.close();
    }
  }
  await setMeta('migrationAsked', true, db);
  syncStatus.set({ migrationOffer: false });
  await syncNow();
}

export async function startSync() {
  if (started) return;
  started = true;
  await refreshCounts();
  subscribe((e) => {
    if (e.type === 'local-change') {
      void refreshCounts();
      if (engine) schedule(2_000);
    }
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void syncNow());
    window.addEventListener('offline', () => syncStatus.set({ state: engine ? 'offline' : 'local' }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void syncNow();
    });
  }
  const sb = getSupabase();
  if (!sb) {
    syncStatus.set({ state: 'local' });
    return;
  }
  const { data } = await sb.auth.getSession();
  await activateUser(data.session);
  sb.auth.onAuthStateChange((_event, session) => {
    void activateUser(session);
  });
}

// ---------------- 認証操作 ----------------

function requireSb(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) throw new Error('クラウド同期が設定されていません');
  return sb;
}

export function translateAuthError(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return 'メールアドレスまたはパスワードが違います。';
  if (/Email not confirmed/i.test(msg)) return 'メールアドレスの確認が終わっていません。届いたメールのリンクを開いてから、もう一度ログインしてください。';
  if (/already registered|already been registered/i.test(msg)) return 'このメールアドレスは登録済みです。ログインしてください。';
  if (/Password should be/i.test(msg)) return 'パスワードは8文字以上にしてください。';
  if (/fetch|network/i.test(msg)) return '通信できませんでした。電波の良い場所でもう一度お試しください。';
  return '処理できませんでした。時間をおいてもう一度お試しください。';
}

export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm-email'> {
  const { data, error } = await requireSb().auth.signUp({ email, password });
  if (error) throw new Error(translateAuthError(error.message));
  return data.session ? 'signed-in' : 'confirm-email';
}

export async function signIn(email: string, password: string) {
  const { error } = await requireSb().auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuthError(error.message));
}

/**
 * ログアウト。
 * 未同期の変更がある場合は force=true でない限りログアウトしない（データ消失防止）。
 * ログアウト後、この端末からアカウントのデータを消去する（次に使う人に見えないように）。
 */
export async function signOut(force = false): Promise<{ ok: boolean; pending: number }> {
  await syncNow();
  const db = getDb();
  const pending = await pendingCount(db);
  if (pending > 0 && !force) return { ok: false, pending };
  const uid = syncStatus.get().userId;
  await requireSb().auth.signOut({ scope: 'local' });
  await activateUser(null);
  if (uid) await Dexie.delete(userDbName(uid));
  return { ok: true, pending };
}

/** アカウントとクラウド上の全データを削除 */
export async function deleteAccount() {
  const sb = requireSb();
  const { error } = await sb.rpc('lp_delete_my_account');
  if (error) throw new Error('アカウントを削除できませんでした。通信状況を確認してもう一度お試しください。');
  const uid = syncStatus.get().userId;
  await sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
  await activateUser(null);
  if (uid) await Dexie.delete(userDbName(uid));
}

export async function resolveConflict(id: string, choice: 'local' | 'server' | 'both') {
  if (!engine) return;
  await engine.resolveConflict(id, choice);
  await syncNow();
}
