import type { PushOp, PushResult, PullResult, ServerRow, SyncTransport } from '../../src/sync/transport';
import { NetworkError } from '../../src/sync/transport';

interface Stored extends ServerRow {
  lastOpId: string | null;
  userId: string;
}

/**
 * supabase/migrations の lp_push / records と同じ規則で動くテスト用サーバー。
 * 障害注入: failBeforeApply（送信失敗）, dropResponse（保存後に応答だけ失われる）
 */
export class FakeServer {
  rows = new Map<string, Stored>();
  rev = 0;
  failBeforeApply = false;
  dropResponse = false;
  failPull = false;
  pushCalls = 0;

  transport(userId: string): SyncTransport {
    return {
      push: (ops) => this.push(userId, ops),
      pull: (after, limit) => this.pull(userId, after, limit),
    };
  }

  private key(u: string, t: string, id: string) {
    return `${u}|${t}|${id}`;
  }

  async push(userId: string, ops: PushOp[]): Promise<PushResult[]> {
    this.pushCalls++;
    if (this.failBeforeApply) throw new NetworkError('connection lost');
    const results: PushResult[] = [];
    for (const op of ops) {
      const k = this.key(userId, op.table, op.id);
      const cur = this.rows.get(k);
      if (cur) {
        if (cur.lastOpId === op.opId) {
          results.push({ opId: op.opId, status: 'ok', version: cur.version, rev: cur.rev });
          continue;
        }
        if (cur.version !== op.baseVersion) {
          results.push({ opId: op.opId, status: 'conflict', server: { table: cur.table, id: cur.id, data: cur.data, version: cur.version, deleted: cur.deleted, rev: cur.rev } });
          continue;
        }
        const next: Stored = { ...cur, data: structuredClone(op.data), deleted: op.deleted, version: cur.version + 1, rev: ++this.rev, lastOpId: op.opId };
        this.rows.set(k, next);
        results.push({ opId: op.opId, status: 'ok', version: next.version, rev: next.rev });
      } else {
        const next: Stored = { userId, table: op.table, id: op.id, data: structuredClone(op.data), deleted: op.deleted, version: 1, rev: ++this.rev, lastOpId: op.opId };
        this.rows.set(k, next);
        results.push({ opId: op.opId, status: 'ok', version: 1, rev: next.rev });
      }
    }
    if (this.dropResponse) throw new NetworkError('response lost');
    return results;
  }

  async pull(userId: string, after: number, limit: number): Promise<PullResult> {
    if (this.failPull) throw new NetworkError('connection lost');
    const rows = [...this.rows.values()]
      .filter((r) => r.userId === userId && r.rev > after)
      .sort((a, b) => a.rev - b.rev)
      .slice(0, limit)
      .map(({ table, id, data, version, deleted, rev }) => ({ table, id, data: structuredClone(data), version, deleted, rev }));
    return { rows };
  }

  get(userId: string, table: string, id: string) {
    return this.rows.get(this.key(userId, table, id));
  }

  countFor(userId: string, table: string) {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.table === table).length;
  }
}
