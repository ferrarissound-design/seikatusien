import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { LifePartnerDB } from '../../src/db/db';

describe('データベースのバージョン更新', () => {
  it('v1 のデータを保持したまま v2 に移行できる', async () => {
    const name = 'migration-test-1';
    // 旧バージョン（v1）のアプリが作ったDBを再現
    const v1 = new Dexie(name);
    v1.version(1).stores({
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
    await v1.open();
    await v1.table('checklists').add({ id: 'c1', name: '仕事', deleted: 0, sortOrder: 0 });
    await v1.table('transactions').add({ id: 't1', amount: 1234, deleted: 0, date: '2026-01-01', type: 'expense' });
    await v1.table('outbox').add({ opId: 'o1', table: 'transactions', recordId: 't1', sentAt: null, blocked: 0 });
    v1.close();

    const v2 = new LifePartnerDB(name);
    await v2.open();
    expect(v2.verno).toBe(2);
    expect((await v2.checklists.get('c1'))?.showOnHome).toBe(1);
    expect((await v2.checklists.get('c1'))?.name).toBe('仕事');
    expect((await v2.transactions.get('t1'))?.amount).toBe(1234);
    expect(await v2.outbox.count()).toBe(1); // 未同期キューも消えない
    expect(await v2.reminders.count()).toBe(0);
    v2.close();
  });
});
