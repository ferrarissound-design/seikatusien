import type { SyncTable } from '../db/types';

/** サーバーに保存されている1レコード */
export interface ServerRow {
  table: SyncTable;
  id: string;
  data: Record<string, unknown>;
  version: number;
  deleted: boolean;
  rev: number;
}

export interface PushOp {
  opId: string;
  table: SyncTable;
  id: string;
  /** クライアントが最後に確認したサーバー版（新規は 0） */
  baseVersion: number;
  data: Record<string, unknown>;
  deleted: boolean;
}

export type PushResult =
  | { opId: string; status: 'ok'; version: number; rev: number }
  | { opId: string; status: 'conflict'; server: ServerRow }
  | { opId: string; status: 'rejected'; reason: string };

export interface PullResult {
  rows: ServerRow[];
}

/** 同期エンジンが利用する通信層（Supabase 実装とテスト用実装を差し替え可能） */
export interface SyncTransport {
  push(ops: PushOp[]): Promise<PushResult[]>;
  pull(afterRev: number, limit: number): Promise<PullResult>;
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}
