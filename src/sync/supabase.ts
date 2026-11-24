import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PushOp, PushResult, PullResult, ServerRow, SyncTransport } from './transport';
import { NetworkError } from './transport';
import type { SyncTable } from '../db/types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isCloudConfigured = !!(url && anonKey && /^https:\/\//.test(url));

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isCloudConfigured) return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'lp.auth' },
    });
  }
  return client;
}

interface DbRow {
  table_name: string;
  id: string;
  data: Record<string, unknown>;
  version: number;
  deleted: boolean;
  rev: number | string;
}

const toServerRow = (r: DbRow): ServerRow => ({
  table: r.table_name as SyncTable,
  id: r.id,
  data: r.data,
  version: r.version,
  deleted: r.deleted,
  rev: Number(r.rev),
});

/** Supabase（PostgREST + RPC）を使った通信層 */
export class SupabaseTransport implements SyncTransport {
  constructor(private sb: SupabaseClient) {}

  async push(ops: PushOp[]): Promise<PushResult[]> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError('offline');
    const { data, error } = await this.sb.rpc('lp_push', {
      ops: ops.map((o) => ({
        opId: o.opId,
        table: o.table,
        id: o.id,
        baseVersion: o.baseVersion,
        data: o.data,
        deleted: o.deleted,
      })),
    });
    if (error) throw new NetworkError(error.message);
    return (data as Array<Record<string, unknown>>).map((r) => {
      if (r.status === 'conflict') {
        return { opId: String(r.opId), status: 'conflict', server: toServerRow(r.server as DbRow) };
      }
      if (r.status === 'ok') {
        return { opId: String(r.opId), status: 'ok', version: Number(r.version), rev: Number(r.rev) };
      }
      return { opId: String(r.opId), status: 'rejected', reason: String(r.reason ?? 'rejected') };
    });
  }

  async pull(afterRev: number, limit: number): Promise<PullResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError('offline');
    const { data, error } = await this.sb
      .from('records')
      .select('table_name,id,data,version,deleted,rev')
      .gt('rev', afterRev)
      .order('rev', { ascending: true })
      .limit(limit);
    if (error) throw new NetworkError(error.message);
    return { rows: (data as DbRow[]).map(toServerRow) };
  }
}
