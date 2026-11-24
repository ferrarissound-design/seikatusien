import { getDb, LOCAL_DB_NAME, type LifePartnerDB } from './db';
import type { AppSettings, BaseRecord, SyncTable } from './types';
import { SYNC_TABLES } from './types';
import { uuid, nowIso } from '../lib/id';
import { emit } from '../lib/events';

/**
 * すべての書き込みはこのモジュールを経由する。
 * - レコード保存とアウトボックス（未同期キュー）登録を同一トランザクションで行う
 *   → 「保存されたのに同期キューに載らない」状態を作らない
 * - 失敗時は利用者に通知する（save-error イベント）
 */

type Row = BaseRecord & Record<string, unknown>;

export function isSyncEnabledDb(db: LifePartnerDB): boolean {
  return db.name !== LOCAL_DB_NAME;
}

function table(db: LifePartnerDB, t: SyncTable) {
  return db.table(t);
}

export function describeSaveError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const inner = (e as { inner?: { name?: string } })?.inner?.name ?? '';
  if (name === 'QuotaExceededError' || inner === 'QuotaExceededError') {
    return '端末の空き容量が不足しているため保存できませんでした。不要なデータや写真を削除してから、もう一度お試しください。';
  }
  return '保存できませんでした。もう一度お試しください。問題が続く場合は「設定 > バックアップ」から書き出しをおすすめします。';
}

export async function enqueue(db: LifePartnerDB, t: SyncTable, recordId: string, deleted: 0 | 1) {
  if (!isSyncEnabledDb(db)) return;
  const existing = await db.outbox
    .where('[table+recordId]')
    .equals([t, recordId])
    .filter((e) => e.sentAt === null && e.blocked === 0)
    .first();
  if (existing) {
    // 未送信エントリーは送信時に最新内容を読むため、削除フラグのみ更新
    await db.outbox.update(existing.seq!, { deleted, enqueuedAt: nowIso() });
    return;
  }
  await db.outbox.add({
    opId: uuid(),
    table: t,
    recordId,
    enqueuedAt: nowIso(),
    sentAt: null,
    baseVersion: null,
    payload: null,
    deleted,
    attempts: 0,
    lastError: null,
    blocked: 0,
  });
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const r = await fn();
    emit({ type: 'local-change' });
    return r;
  } catch (e) {
    emit({ type: 'save-error', message: describeSaveError(e) });
    throw e;
  }
}

export async function createRecord<T extends BaseRecord>(
  t: SyncTable,
  data: Omit<T, keyof BaseRecord> & Partial<BaseRecord>,
): Promise<T> {
  const db = getDb();
  const ts = nowIso();
  const rec = {
    ...data,
    id: data.id ?? uuid(),
    createdAt: data.createdAt ?? ts,
    updatedAt: ts,
    serverVersion: 0,
    deleted: 0,
  } as unknown as T;
  await guarded(() =>
    db.transaction('rw', [table(db, t), db.outbox], async () => {
      await table(db, t).add(rec);
      await enqueue(db, t, rec.id, 0);
    }),
  );
  return rec;
}

export async function updateRecord<T extends BaseRecord>(
  t: SyncTable,
  id: string,
  changes: Partial<Omit<T, keyof BaseRecord>>,
): Promise<void> {
  const db = getDb();
  await guarded(() =>
    db.transaction('rw', [table(db, t), db.outbox], async () => {
      const cur = (await table(db, t).get(id)) as Row | undefined;
      if (!cur) throw new Error('record not found');
      await table(db, t).put({ ...cur, ...changes, id, updatedAt: nowIso() });
      await enqueue(db, t, id, cur.deleted);
    }),
  );
}

/** 複数レコードを一括更新（並び替え等） */
export async function bulkUpdate(t: SyncTable, updates: { id: string; changes: Record<string, unknown> }[]) {
  const db = getDb();
  await guarded(() =>
    db.transaction('rw', [table(db, t), db.outbox], async () => {
      const ts = nowIso();
      for (const u of updates) {
        const cur = (await table(db, t).get(u.id)) as Row | undefined;
        if (!cur) continue;
        await table(db, t).put({ ...cur, ...u.changes, updatedAt: ts });
        await enqueue(db, t, u.id, cur.deleted);
      }
    }),
  );
}

/** 削除（論理削除）。元に戻せる。 */
export async function softDelete(t: SyncTable, ids: string | string[]): Promise<void> {
  await setDeleted(t, Array.isArray(ids) ? ids : [ids], 1);
}

export async function restore(t: SyncTable, ids: string | string[]): Promise<void> {
  await setDeleted(t, Array.isArray(ids) ? ids : [ids], 0);
}

async function setDeleted(t: SyncTable, ids: string[], deleted: 0 | 1) {
  const db = getDb();
  await guarded(() =>
    db.transaction('rw', [table(db, t), db.outbox], async () => {
      const ts = nowIso();
      for (const id of ids) {
        const cur = (await table(db, t).get(id)) as Row | undefined;
        if (!cur) continue;
        await table(db, t).put({ ...cur, deleted, updatedAt: ts });
        await enqueue(db, t, id, deleted);
      }
    }),
  );
}

// ---------------- 設定 ----------------

export const SETTINGS_ID = 'settings';

export const DEFAULT_EXPENSE_CATEGORIES = ['食費', 'コンビニ', '交通費', '趣味', '日用品', 'その他'];
export const DEFAULT_TASK_CATEGORIES = ['生活', '仕事', '学校', '手続き', '買い物', 'その他'];

export function defaultSettings(): AppSettings {
  const ts = nowIso();
  let tz = 'Asia/Tokyo';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
  } catch {
    /* noop */
  }
  return {
    id: SETTINGS_ID,
    createdAt: ts,
    updatedAt: ts,
    serverVersion: 0,
    deleted: 0,
    features: { checklists: true, tasks: true, money: true, weight: false },
    paydayDay: null,
    paydayWeekendRule: 'before',
    balanceAmount: null,
    balanceAsOf: null,
    monthlyBudget: null,
    reserveAmount: 0,
    expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
    taskCategories: [...DEFAULT_TASK_CATEGORIES],
    theme: 'system',
    reduceMotion: 'system',
    fontScale: 1,
    taskRollover: true,
    onboardingDone: false,
    timezone: tz,
  };
}

/** 既定値で欠損フィールドを補う（古いバックアップや他端末の旧版データ対策） */
export function normalizeSettings(s: Partial<AppSettings> | undefined): AppSettings {
  const d = defaultSettings();
  if (!s) return d;
  return {
    ...d,
    ...s,
    features: { ...d.features, ...(s.features ?? {}) },
    expenseCategories: Array.isArray(s.expenseCategories) && s.expenseCategories.length ? s.expenseCategories : d.expenseCategories,
    taskCategories: Array.isArray(s.taskCategories) && s.taskCategories.length ? s.taskCategories : d.taskCategories,
    id: SETTINGS_ID,
  } as AppSettings;
}

export async function getSettings(db: LifePartnerDB = getDb()): Promise<AppSettings> {
  return normalizeSettings(await db.settings.get(SETTINGS_ID));
}

export async function saveSettings(changes: Partial<Omit<AppSettings, keyof BaseRecord>>): Promise<void> {
  const db = getDb();
  await guarded(() =>
    db.transaction('rw', [db.settings, db.outbox], async () => {
      const cur = await getSettings(db);
      await db.settings.put({ ...cur, ...changes, updatedAt: nowIso() });
      await enqueue(db, 'settings', SETTINGS_ID, 0);
    }),
  );
}

// ---------------- メタ情報 ----------------

export async function getMeta<T>(key: string, db: LifePartnerDB = getDb()): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown, db: LifePartnerDB = getDb()) {
  await db.meta.put({ key, value });
}

/** 全同期テーブルの全レコードをアウトボックスに積む（ローカル→アカウント移行時） */
export async function enqueueAll(db: LifePartnerDB) {
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.outbox], async () => {
    for (const t of SYNC_TABLES) {
      const rows = (await db.table(t).toArray()) as Row[];
      for (const r of rows) await enqueue(db, t, r.id, r.deleted);
    }
  });
}
