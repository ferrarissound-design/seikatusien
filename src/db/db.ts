import Dexie, { type Table } from 'dexie';
import type {
  Checklist,
  CheckItem,
  CheckHistory,
  Task,
  Subtask,
  Transaction,
  FixedCost,
  SavingsGoal,
  Reminder,
  AppSettings,
  OutboxEntry,
  Conflict,
  MetaEntry,
  InAppNotice,
} from './types';

/**
 * データベース定義。
 *
 * ■ スキーマ変更のルール（既存データを守るため必ず守る）
 *   1. 既存の version(n) の定義は絶対に書き換えない・削除しない。
 *   2. 変更は新しい version(n+1) を追加し、必要なら .upgrade() でデータを移行する。
 *   3. upgrade 内でデータを削除しない。変換できない値は既定値で補う。
 *   4. 変更したら tests/unit/db-migration.test.ts に移行テストを追加する。
 */
export class LifePartnerDB extends Dexie {
  checklists!: Table<Checklist, string>;
  checkItems!: Table<CheckItem, string>;
  checkHistory!: Table<CheckHistory, string>;
  tasks!: Table<Task, string>;
  subtasks!: Table<Subtask, string>;
  transactions!: Table<Transaction, string>;
  fixedCosts!: Table<FixedCost, string>;
  savingsGoals!: Table<SavingsGoal, string>;
  reminders!: Table<Reminder, string>;
  settings!: Table<AppSettings, string>;
  outbox!: Table<OutboxEntry, number>;
  conflicts!: Table<Conflict, string>;
  meta!: Table<MetaEntry, string>;
  notices!: Table<InAppNotice, string>;

  constructor(name: string) {
    super(name);

    // v1: 初期スキーマ
    this.version(1).stores({
      checklists: 'id, deleted, sortOrder',
      checkItems: 'id, checklistId, deleted',
      checkHistory: 'id, checklistId, date',
      tasks: 'id, deleted, done, dueDate, seriesId',
      subtasks: 'id, taskId',
      transactions: 'id, deleted, date, type, fixedCostId',
      fixedCosts: 'id, deleted',
      savingsGoals: 'id, deleted',
      settings: 'id',
      outbox: '++seq, recordId, [table+recordId]',
      conflicts: 'id, status, recordId',
      meta: 'key',
    });

    // v2: リマインダー・アプリ内通知を追加。チェックリストに showOnHome を追加。
    this.version(2)
      .stores({
        reminders: 'id, deleted, kind',
        notices: 'id, &key, read',
      })
      .upgrade(async (tx) => {
        await tx
          .table('checklists')
          .toCollection()
          .modify((c: Partial<Checklist>) => {
            if (c.showOnHome === undefined) c.showOnHome = 1;
          });
      });
  }
}

export const LOCAL_DB_NAME = 'lifepartner-local';
export const userDbName = (userId: string) => `lifepartner-u-${userId}`;

let current: LifePartnerDB | null = null;
const listeners = new Set<(db: LifePartnerDB) => void>();

/** 現在アクティブなデータベース（アカウントごとに分離） */
export function getDb(): LifePartnerDB {
  if (!current) current = new LifePartnerDB(LOCAL_DB_NAME);
  return current;
}

export function setActiveDb(name: string): LifePartnerDB {
  if (current && current.name === name && !current.hasBeenClosed()) return current;
  current?.close();
  current = new LifePartnerDB(name);
  listeners.forEach((l) => l(current!));
  return current;
}

/** テスト用：既存のインスタンスを閉じずにアクティブにする（複数端末の再現） */
export function adoptDb(db: LifePartnerDB): LifePartnerDB {
  current = db;
  return db;
}

export function onDbChange(fn: (db: LifePartnerDB) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
