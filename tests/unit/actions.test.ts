import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActiveDb } from '../../src/db/db';
import {
  createChecklist,
  activeItems,
  toggleCheckItem,
  runChecklistResets,
  createTask,
  setTaskDone,
  runTaskRollover,
  markFixedCostPaid,
  addTransaction,
} from '../../src/db/actions';
import { createRecord, updateRecord, saveSettings } from '../../src/db/repo';
import type { Checklist, FixedCost } from '../../src/db/types';

let n = 0;
beforeEach(() => {
  n++;
  setActiveDb(`lifepartner-local-test-${n}`);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('忘れ物チェック', () => {
  it('テンプレートから作成・全確認で完了履歴', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 20, 8, 0));
    const list = await createChecklist('', 'hospital');
    const items = await activeItems(list.id);
    expect(items.length).toBeGreaterThan(3);
    for (const it of items) await toggleCheckItem(it);
    const db = setActiveDb(`lifepartner-local-test-${n}`);
    const h = await db.checkHistory.toArray();
    expect(h).toHaveLength(1);
    expect(h[0].reason).toBe('complete');
    expect(h[0].checkedCount).toBe(items.length);
  });

  it('アプリを開いていない間に日付が変わっても、次回起動時にリセット・履歴は残す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 20, 8, 0));
    const list = await createChecklist('仕事', 'work');
    const items = await activeItems(list.id);
    await toggleCheckItem(items[0]);
    await toggleCheckItem(items[1]);

    // 同日内（リセット時刻前の深夜）にはリセットしない
    vi.setSystemTime(new Date(2026, 10, 21, 3, 0));
    expect(await runChecklistResets()).toBe(0);

    // 3日後に起動
    vi.setSystemTime(new Date(2026, 10, 23, 9, 0));
    expect(await runChecklistResets()).toBe(1);
    const after = await activeItems(list.id);
    expect(after.every((i) => !i.checked)).toBe(true);
    const db = setActiveDb(`lifepartner-local-test-${n}`);
    const h = await db.checkHistory.toArray();
    expect(h).toHaveLength(1);
    expect(h[0].date).toBe('2026-11-20');
    expect(h[0].checkedCount).toBe(2);
    // 2回目の起動では何もしない（冪等）
    expect(await runChecklistResets()).toBe(0);
    expect((await db.checklists.get(list.id))?.lastResetDate).toBe('2026-11-23');
  });

  it('端末の時計が戻ってもリセットしない', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 20, 8, 0));
    const list = await createChecklist('外出', 'outing');
    await updateRecord<Checklist>('checklists', list.id, { lastResetDate: '2026-11-25' });
    expect(await runChecklistResets()).toBe(0);
  });
});

describe('タスク', () => {
  it('未完了タスクは翌日に繰り越し、元の日付を記録', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 31, 10, 0));
    const t = await createTask({ title: '年賀状', dueDate: '2026-12-31' });
    vi.setSystemTime(new Date(2027, 0, 2, 10, 0));
    expect(await runTaskRollover()).toBe(1);
    const db = setActiveDb(`lifepartner-local-test-${n}`);
    const after = await db.tasks.get(t.id);
    expect(after?.dueDate).toBe('2027-01-02');
    expect(after?.carriedFrom).toBe('2026-12-31');
  });

  it('繰り越しをオフにできる', async () => {
    await saveSettings({ taskRollover: false });
    await createTask({ title: 'x', dueDate: '2000-01-01' });
    expect(await runTaskRollover()).toBe(0);
  });

  it('繰り返しタスクは完了時に次回分を1件だけ作る（決定的ID）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 20, 10, 0));
    const t = await createTask({ title: 'ゴミ出し', recurrence: { kind: 'weekly', weekdays: [1, 4] } });
    expect(t.dueDate).toBe('2026-11-20');
    await setTaskDone(t, true);
    await setTaskDone(t, true); // 2回押しても重複しない
    const db = setActiveDb(`lifepartner-local-test-${n}`);
    const all = (await db.tasks.toArray()).filter((x) => !x.deleted);
    expect(all).toHaveLength(2);
    const next = all.find((x) => x.id !== t.id)!;
    expect(next.dueDate).toBe('2026-11-23'); // 金曜の次の月曜
    expect(next.seriesId).toBe(t.id);

    // 完了取り消しで未着手の次回分は取り下げ
    await setTaskDone({ ...t, done: 1 }, false);
    const live = (await db.tasks.toArray()).filter((x) => !x.deleted);
    expect(live).toHaveLength(1);
  });
});

describe('固定費', () => {
  it('同じ期の支払記録は二重登録しない', async () => {
    const f = await createRecord<FixedCost>('fixedCosts', { name: '家賃', amount: 50000, dayOfMonth: 27, category: '住居', active: 1 });
    await markFixedCostPaid(f, '2026-11');
    await markFixedCostPaid(f, '2026-11');
    const db = setActiveDb(`lifepartner-local-test-${n}`);
    expect(await db.transactions.count()).toBe(1);
  });
  it('不正な金額は保存しない', async () => {
    await expect(addTransaction({ type: 'expense', amount: 1.5, category: 'x' })).rejects.toThrow();
    await expect(addTransaction({ type: 'expense', amount: -1, category: 'x' })).rejects.toThrow();
  });
});

describe('ローカルモード', () => {
  it('ローカルモードでは同期キューに積まない', async () => {
    const db = setActiveDb('lifepartner-local');
    await createTask({ title: 'ローカル' });
    expect(await db.outbox.count()).toBe(0);
    await db.delete();
  });
});
