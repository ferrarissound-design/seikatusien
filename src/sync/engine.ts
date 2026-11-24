import type { LifePartnerDB } from '../db/db';
import type { BaseRecord, Conflict, OutboxEntry, SyncTable } from '../db/types';
import { MONEY_TABLES, SYNC_TABLES } from '../db/types';
import { getMeta, setMeta, normalizeSettings } from '../db/repo';
import { uuid, nowIso } from '../lib/id';
import { stableStringify } from '../lib/stable';
import type { PushOp, PushResult, ServerRow, SyncTransport } from './transport';

/**
 * 同期エンジン
 *
 * 設計の要点（詳細は ARCHITECTURE.md）
 * 1. 端末内の変更はすべてアウトボックス（IndexedDB）に永続化される。
 * 2. 送信前にペイロードと baseVersion をアウトボックスへ書き込み、同じ opId で再送する。
 *    サーバーは last_op_id で同一操作の再送を判別し、二重適用しない（冪等）。
 * 3. サーバーが「保存した」と応答するまでアウトボックスから消さない。
 * 4. サーバー版が baseVersion と異なる場合は競合。新しい方で黙って上書きしない。
 *    - 金銭記録: 利用者の確認待ち（どちらも保持）
 *    - その他: 更新日時が新しい方を採用し、採用しなかった方を競合履歴に保存（復元可能）
 * 5. 取得（pull）は rev（サーバー側の単調増加番号）をカーソルにする。
 *    未送信の変更があるレコードには取得結果を上書きしない。
 */

const LOCAL_FIELDS = ['serverVersion'] as const;
const PUSH_BATCH = 50;
const PULL_LIMIT = 500;

type Row = BaseRecord & Record<string, unknown>;

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  error: string | null;
}

export function toPayload(rec: Row): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rec };
  for (const f of LOCAL_FIELDS) delete out[f];
  return out;
}

function isSyncTable(t: unknown): t is SyncTable {
  return typeof t === 'string' && (SYNC_TABLES as readonly string[]).includes(t);
}

function contentEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = (o: Record<string, unknown>) => {
    const c = { ...o };
    delete c.updatedAt;
    delete c.serverVersion;
    return stableStringify(c);
  };
  return strip(a) === strip(b);
}

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;

  constructor(
    private db: LifePartnerDB,
    private transport: SyncTransport,
  ) {}

  /** 多重実行を防いで1回同期する */
  sync(): Promise<SyncReport> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, error: null };
    try {
      await this.pushAll(report);
      await this.pullAll(report);
      // 取得中に別端末の変更と競合した可能性があるため、もう一度だけ送信
      await this.pushAll(report);
      await setMeta('lastSyncAt', nowIso(), this.db);
      await setMeta('lastSyncError', null, this.db);
    } catch (e) {
      report.error = e instanceof Error ? e.message : String(e);
      await setMeta('lastSyncError', report.error, this.db).catch(() => undefined);
    }
    return report;
  }

  // ---------------- push ----------------

  private async pushAll(report: SyncReport) {
    for (let guard = 0; guard < 200; guard++) {
      const batch = await this.prepareBatch();
      if (!batch.length) return;
      let results: PushResult[];
      try {
        results = await this.transport.push(batch.map((b) => b.op));
      } catch (e) {
        await this.db.transaction('rw', this.db.outbox, async () => {
          for (const b of batch) {
            await this.db.outbox.update(b.entry.seq!, {
              attempts: b.entry.attempts + 1,
              lastError: e instanceof Error ? e.message : String(e),
            });
          }
        });
        throw e;
      }
      const byOp = new Map(results.map((r) => [r.opId, r]));
      for (const b of batch) {
        const r = byOp.get(b.op.opId);
        if (!r) continue; // 応答なし → 次回同じ opId で再送
        if (r.status === 'ok') {
          await this.applyPushOk(b.entry, r.version);
          report.pushed++;
        } else if (r.status === 'conflict') {
          await this.handleConflict(b.entry, r.server);
          report.conflicts++;
        } else {
          await this.db.outbox.update(b.entry.seq!, { blocked: 1, lastError: r.reason });
        }
      }
    }
  }

  /** 送信するエントリーを確定し、ペイロードを永続化する（1レコードにつき1件） */
  private async prepareBatch(): Promise<{ entry: OutboxEntry; op: PushOp }[]> {
    return this.db.transaction('rw', [this.db.outbox, ...SYNC_TABLES.map((t) => this.db.table(t))], async () => {
      const entries = await this.db.outbox.orderBy('seq').filter((e) => e.blocked === 0).toArray();
      const seen = new Set<string>();
      const out: { entry: OutboxEntry; op: PushOp }[] = [];
      for (const e of entries) {
        const key = `${e.table}:${e.recordId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!isSyncTable(e.table)) {
          await this.db.outbox.delete(e.seq!);
          continue;
        }
        if (e.sentAt && e.payload && e.baseVersion !== null) {
          // 送信済み（応答未確認）→ 同じ内容・同じ opId で再送
          out.push({
            entry: e,
            op: { opId: e.opId, table: e.table, id: e.recordId, baseVersion: e.baseVersion, data: e.payload, deleted: !!e.deleted },
          });
        } else {
          const rec = (await this.db.table(e.table).get(e.recordId)) as Row | undefined;
          if (!rec) {
            await this.db.outbox.delete(e.seq!);
            continue;
          }
          const payload = toPayload(rec);
          const baseVersion = rec.serverVersion ?? 0;
          const sentAt = nowIso();
          await this.db.outbox.update(e.seq!, { sentAt, payload, baseVersion, deleted: rec.deleted });
          out.push({
            entry: { ...e, sentAt, payload, baseVersion, deleted: rec.deleted },
            op: { opId: e.opId, table: e.table, id: e.recordId, baseVersion, data: payload, deleted: !!rec.deleted },
          });
        }
        if (out.length >= PUSH_BATCH) break;
      }
      return out;
    });
  }

  private async applyPushOk(entry: OutboxEntry, version: number) {
    const t = this.db.table(entry.table);
    await this.db.transaction('rw', [this.db.outbox, t], async () => {
      await this.db.outbox.delete(entry.seq!);
      const rec = (await t.get(entry.recordId)) as Row | undefined;
      if (rec && (rec.serverVersion ?? 0) < version) {
        await t.put({ ...rec, serverVersion: version });
      }
    });
  }

  private async handleConflict(entry: OutboxEntry, server: ServerRow) {
    const t = this.db.table(entry.table);
    await this.db.transaction('rw', [this.db.outbox, this.db.conflicts, t], async () => {
      const local = (await t.get(entry.recordId)) as Row | undefined;
      const localData = local ? toPayload(local) : (entry.payload ?? {});
      const serverData: Record<string, unknown> = { ...server.data, deleted: server.deleted ? 1 : 0 };

      // 内容が同じなら競合ではない（同じ変更が別経路で届いた）
      if (contentEqual(localData, serverData)) {
        await this.db.outbox.where('[table+recordId]').equals([entry.table, entry.recordId]).delete();
        if (local) await t.put({ ...local, serverVersion: server.version });
        return;
      }

      const conflict: Conflict = {
        id: uuid(),
        table: entry.table,
        recordId: entry.recordId,
        detectedAt: nowIso(),
        local: localData,
        server: serverData,
        serverVersion: server.version,
        status: 'pending',
        resolution: null,
      };

      if (MONEY_TABLES.includes(entry.table)) {
        // 金銭記録：自動で捨てない。利用者が確認するまで送信を保留。
        await this.db.outbox.update(entry.seq!, { blocked: 1, lastError: 'conflict' });
        await this.db.conflicts.add(conflict);
        return;
      }

      let winner: 'local' | 'server';
      let merged: Record<string, unknown> | null = null;
      if (entry.table === 'settings') {
        merged = mergeSettings(localData, serverData);
        winner = 'local';
      } else {
        winner = String(localData.updatedAt ?? '') > String(serverData.updatedAt ?? '') ? 'local' : 'server';
      }

      conflict.status = 'auto-resolved';
      conflict.resolution = winner;
      await this.db.conflicts.add(conflict);

      if (winner === 'local') {
        // サーバー版を基準に、こちらの内容で再送
        const next = merged ?? localData;
        await t.put({ ...next, serverVersion: server.version });
        await this.db.outbox.update(entry.seq!, { sentAt: null, payload: null, baseVersion: null, opId: uuid() });
      } else {
        await t.put({ ...serverData, id: entry.recordId, serverVersion: server.version });
        await this.db.outbox.where('[table+recordId]').equals([entry.table, entry.recordId]).delete();
      }
    });
  }

  // ---------------- pull ----------------

  private async pullAll(report: SyncReport) {
    let cursor = (await getMeta<number>('pullCursor', this.db)) ?? 0;
    for (let guard = 0; guard < 1000; guard++) {
      const { rows } = await this.transport.pull(cursor, PULL_LIMIT);
      if (!rows.length) break;
      await this.db.transaction('rw', [this.db.outbox, this.db.meta, ...SYNC_TABLES.map((t) => this.db.table(t))], async () => {
        for (const row of rows) {
          if (!isSyncTable(row.table)) continue;
          const pending = await this.db.outbox.where('[table+recordId]').equals([row.table, row.id]).count();
          if (pending > 0) continue; // 未送信の変更を優先（送信時に競合として検出される）
          const t = this.db.table(row.table);
          const local = (await t.get(row.id)) as Row | undefined;
          if (local && (local.serverVersion ?? 0) >= row.version) continue;
          await t.put({ ...row.data, id: row.id, deleted: row.deleted ? 1 : 0, serverVersion: row.version });
          report.pulled++;
        }
        cursor = Math.max(cursor, ...rows.map((r) => r.rev));
        await this.db.meta.put({ key: 'pullCursor', value: cursor });
      });
      if (rows.length < PULL_LIMIT) break;
    }
  }

  // ---------------- 競合の解決（利用者の操作） ----------------

  async resolveConflict(conflictId: string, choice: 'local' | 'server' | 'both') {
    const c = await this.db.conflicts.get(conflictId);
    if (!c || c.status !== 'pending') return;
    const t = this.db.table(c.table);
    await this.db.transaction('rw', [this.db.outbox, this.db.conflicts, t], async () => {
      const entries = await this.db.outbox.where('[table+recordId]').equals([c.table, c.recordId]).toArray();
      if (choice === 'server' || choice === 'both') {
        if (c.server) await t.put({ ...c.server, id: c.recordId, serverVersion: c.serverVersion });
        await this.db.outbox.bulkDelete(entries.map((e) => e.seq!));
        if (choice === 'both') {
          // 端末側の内容を別レコードとして残す（取引記録の両方を保持）
          const ts = nowIso();
          const copy = { ...c.local, id: uuid(), createdAt: ts, updatedAt: ts, serverVersion: 0, deleted: 0 };
          await t.add(copy);
          await this.db.outbox.add({
            opId: uuid(),
            table: c.table,
            recordId: copy.id as string,
            enqueuedAt: ts,
            sentAt: null,
            baseVersion: null,
            payload: null,
            deleted: 0,
            attempts: 0,
            lastError: null,
            blocked: 0,
          });
        }
      } else {
        const rec = (await t.get(c.recordId)) as Row | undefined;
        await t.put({ ...(rec ?? c.local), ...c.local, id: c.recordId, updatedAt: nowIso(), serverVersion: c.serverVersion });
        await this.db.outbox.bulkDelete(entries.map((e) => e.seq!));
        await this.db.outbox.add({
          opId: uuid(),
          table: c.table,
          recordId: c.recordId,
          enqueuedAt: nowIso(),
          sentAt: null,
          baseVersion: null,
          payload: null,
          deleted: (c.local.deleted as 0 | 1) ?? 0,
          attempts: 0,
          lastError: null,
          blocked: 0,
        });
      }
      await this.db.conflicts.update(c.id, { status: 'resolved', resolution: choice });
    });
  }
}

/** 設定の競合：基本は新しい方、残高は「登録日時が新しい方」の組を採用 */
export function mergeSettings(local: Record<string, unknown>, server: Record<string, unknown>): Record<string, unknown> {
  const newer = String(local.updatedAt ?? '') >= String(server.updatedAt ?? '') ? local : server;
  const older = newer === local ? server : local;
  const merged: Record<string, unknown> = { ...normalizeSettings(older as never), ...newer };
  const lb = String(local.balanceAsOf ?? '');
  const sb = String(server.balanceAsOf ?? '');
  const balSrc = lb >= sb ? local : server;
  merged.balanceAmount = balSrc.balanceAmount ?? null;
  merged.balanceAsOf = balSrc.balanceAsOf ?? null;
  merged.updatedAt = nowIso();
  return merged;
}

export async function pendingCount(db: LifePartnerDB): Promise<number> {
  const all = await db.outbox.toArray();
  return new Set(all.map((e) => `${e.table}:${e.recordId}`)).size;
}
