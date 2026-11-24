import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { LifePartnerDB } from '../../src/db/db';
import { getSettings } from '../../src/db/repo';

describe('データベースの更新 v2 → v3（体重の追加）', () => {
  it('既存データと未同期キューを保持し、体重の表が追加される。体重機能は初期オフ', async () => {
    const name = 'migration-test-v3';
    const v2 = new Dexie(name);
    v2.version(1).stores({
      checklists: 'id, deleted, sortOrder', checkItems: 'id, checklistId, deleted', checkHistory: 'id, checklistId, date',
      tasks: 'id, deleted, done, dueDate, seriesId', subtasks: 'id, taskId', transactions: 'id, deleted, date, type, fixedCostId',
      fixedCosts: 'id, deleted', savingsGoals: 'id, deleted', settings: 'id', outbox: '++seq, recordId, [table+recordId]',
      conflicts: 'id, status, recordId', meta: 'key',
    });
    v2.version(2).stores({ reminders: 'id, deleted, kind', notices: 'id, &key, read' });
    await v2.open();
    await v2.table('transactions').add({ id: 't1', amount: 500, deleted: 0, date: '2026-11-01', type: 'expense' });
    await v2.table('settings').put({ id: 'settings', features: { checklists: true, tasks: false, money: true }, onboardingDone: true });
    await v2.table('outbox').add({ opId: 'o1', table: 'transactions', recordId: 't1', sentAt: null, blocked: 0 });
    v2.close();

    const v3 = new LifePartnerDB(name);
    await v3.open();
    expect(v3.verno).toBe(3);
    expect((await v3.transactions.get('t1'))?.amount).toBe(500);
    expect(await v3.outbox.count()).toBe(1);
    expect(await v3.weights.count()).toBe(0);
    const s = await getSettings(v3);
    expect(s.features).toEqual({ checklists: true, tasks: false, money: true, weight: false });
    v3.close();
  });
});
