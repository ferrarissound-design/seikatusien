import type { LifePartnerDB } from '../db/db';
import { SYNC_TABLES, type SyncTable, type BaseRecord } from '../db/types';
import { enqueue, setMeta, getMeta } from '../db/repo';
import { validateRecord } from './validate';
import { nowIso } from '../lib/id';
import { emit } from '../lib/events';

export const BACKUP_APP_ID = 'life-partner';
export const BACKUP_FORMAT = 1;

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  format: number;
  exportedAt: string;
  schemaVersion: number;
  tables: Partial<Record<SyncTable, Record<string, unknown>[]>>;
}

type Row = BaseRecord & Record<string, unknown>;

export async function buildBackup(db: LifePartnerDB): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {};
  for (const t of SYNC_TABLES) {
    const rows = (await db.table(t).toArray()) as Row[];
    tables[t] = rows.map((r) => {
      const c: Record<string, unknown> = { ...r };
      delete c.serverVersion;
      return c;
    });
  }
  return { app: BACKUP_APP_ID, format: BACKUP_FORMAT, exportedAt: nowIso(), schemaVersion: db.verno, tables };
}

export interface ImportPlan {
  ok: boolean;
  error: string | null;
  exportedAt: string | null;
  /** 新規に追加されるレコード */
  toAdd: { table: SyncTable; rec: Row }[];
  /** 同じIDで内容が違うレコード */
  conflicts: { table: SyncTable; incoming: Row; existing: Row }[];
  identical: number;
  invalid: { table: string; index: number; reason: string }[];
  counts: Partial<Record<SyncTable, number>>;
}

function stableJson(o: Record<string, unknown>) {
  const c = { ...o };
  delete c.serverVersion;
  return JSON.stringify(c, Object.keys(c).sort());
}

/** バックアップファイルを解析し、復元内容を計画する（まだ書き込まない） */
export async function planImport(db: LifePartnerDB, text: string): Promise<ImportPlan> {
  const plan: ImportPlan = { ok: false, error: null, exportedAt: null, toAdd: [], conflicts: [], identical: 0, invalid: [], counts: {} };
  if (text.length > 50 * 1024 * 1024) {
    plan.error = 'ファイルが大きすぎます（50MBまで）。';
    return plan;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    plan.error = 'このファイルは読み込めませんでした。Life Partner で書き出したバックアップファイル（.json）を選んでください。';
    return plan;
  }
  const f = parsed as Partial<BackupFile>;
  if (!f || typeof f !== 'object' || f.app !== BACKUP_APP_ID || typeof f.tables !== 'object' || !f.tables) {
    plan.error = 'Life Partner のバックアップファイルではないようです。';
    return plan;
  }
  if (typeof f.format !== 'number' || f.format > BACKUP_FORMAT) {
    plan.error = 'このバックアップは新しいバージョンのアプリで作成されています。アプリを更新してから読み込んでください。';
    return plan;
  }
  plan.exportedAt = typeof f.exportedAt === 'string' ? f.exportedAt : null;

  for (const [tname, rows] of Object.entries(f.tables)) {
    if (!(SYNC_TABLES as readonly string[]).includes(tname)) continue; // 未知の種類は無視
    const t = tname as SyncTable;
    if (!Array.isArray(rows)) {
      plan.invalid.push({ table: t, index: -1, reason: '形式が正しくありません' });
      continue;
    }
    for (const [i, raw] of rows.entries()) {
      const reason = validateRecord(t, raw);
      if (reason) {
        plan.invalid.push({ table: t, index: i, reason });
        continue;
      }
      const rec = raw as Row;
      const existing = (await db.table(t).get(rec.id)) as Row | undefined;
      if (!existing) {
        plan.toAdd.push({ table: t, rec });
        plan.counts[t] = (plan.counts[t] ?? 0) + 1;
      } else if (stableJson(existing) === stableJson(rec)) {
        plan.identical++;
      } else {
        plan.conflicts.push({ table: t, incoming: rec, existing });
      }
    }
  }
  plan.ok = true;
  return plan;
}

export type ConflictPolicy = 'keep-existing' | 'newer-wins';

/**
 * 計画に従って復元する。既存データは削除しない。
 * 実行前に現在のデータを端末内に退避し、「復元を取り消す」ことができる。
 */
export async function applyImport(db: LifePartnerDB, plan: ImportPlan, policy: ConflictPolicy): Promise<{ added: number; replaced: number }> {
  if (!plan.ok) throw new Error('invalid plan');
  const snapshot = await buildBackup(db);
  let added = 0;
  let replaced = 0;
  try {
    await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.outbox, db.meta], async () => {
      await db.meta.put({ key: 'preRestoreSnapshot', value: { takenAt: nowIso(), json: JSON.stringify(snapshot) } });
      for (const { table, rec } of plan.toAdd) {
        if (await db.table(table).get(rec.id)) continue;
        await db.table(table).add({ ...rec, serverVersion: 0 });
        await enqueue(db, table, rec.id, rec.deleted);
        added++;
      }
      if (policy === 'newer-wins') {
        for (const { table, incoming, existing } of plan.conflicts) {
          if (String(incoming.updatedAt) <= String(existing.updatedAt)) continue;
          // 更新日時がバックアップの方が新しい場合のみ置き換える（復元前の状態は退避済み）
          await db.table(table).put({ ...incoming, serverVersion: existing.serverVersion, updatedAt: nowIso() });
          await enqueue(db, table, incoming.id, incoming.deleted);
          replaced++;
        }
      }
    });
    await setMeta('lastRestoreAt', nowIso(), db);
    emit({ type: 'local-change' });
  } catch (e) {
    emit({ type: 'save-error', message: '復元中にエラーが発生しました。データは変更されていません。' });
    throw e;
  }
  return { added, replaced };
}

/** 直前の復元を取り消す（復元前の状態に戻す） */
export async function undoLastRestore(db: LifePartnerDB): Promise<boolean> {
  const snap = await getMeta<{ takenAt: string; json: string }>('preRestoreSnapshot', db);
  if (!snap) return false;
  const file = JSON.parse(snap.json) as BackupFile;
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.outbox, db.meta], async () => {
    for (const t of SYNC_TABLES) {
      const keep = new Map((file.tables[t] ?? []).map((r) => [r.id as string, r]));
      const rows = (await db.table(t).toArray()) as Row[];
      for (const r of rows) {
        const prev = keep.get(r.id);
        if (!prev) {
          // 復元で追加されたもの → 削除扱い（同期先にも削除を伝える）
          if (!r.deleted) {
            await db.table(t).put({ ...r, deleted: 1, updatedAt: nowIso() });
            await enqueue(db, t, r.id, 1);
          }
        } else if (stableJson(prev) !== stableJson(r)) {
          await db.table(t).put({ ...prev, serverVersion: r.serverVersion, updatedAt: nowIso() });
          await enqueue(db, t, r.id, prev.deleted as 0 | 1);
        }
      }
    }
    await db.meta.delete('preRestoreSnapshot');
  });
  emit({ type: 'local-change' });
  return true;
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** iOS では共有シート（ファイルに保存）を優先し、使えなければダウンロード */
export async function shareOrDownload(filename: string, text: string, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  try {
    const file = new File([text], filename, { type: mime });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
  }
  downloadText(filename, text, mime);
  return 'downloaded';
}
