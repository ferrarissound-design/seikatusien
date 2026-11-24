import { describe, it, expect, beforeEach } from 'vitest';
import { setActiveDb } from '../../src/db/db';
import { buildBackup, planImport, applyImport, undoLastRestore } from '../../src/backup/backup';
import { createTask, addTransaction } from '../../src/db/actions';
import { updateRecord } from '../../src/db/repo';
import type { Task } from '../../src/db/types';

let n = 0;
beforeEach(() => {
  n++;
});

describe('バックアップと復元', () => {
  it('書き出し → 別端末へ復元', async () => {
    const a = setActiveDb(`lifepartner-u-bk-a-${n}`);
    await createTask({ title: '架空のタスク' });
    await addTransaction({ type: 'expense', amount: 980, category: '食費', memo: 'テスト' });
    const json = JSON.stringify(await buildBackup(a));

    const b = setActiveDb(`lifepartner-u-bk-b-${n}`);
    const plan = await planImport(b, json);
    expect(plan.ok).toBe(true);
    expect(plan.toAdd.length).toBeGreaterThanOrEqual(2);
    expect(plan.invalid).toHaveLength(0);
    const r = await applyImport(b, plan, 'keep-existing');
    expect(r.added).toBe(plan.toAdd.length);
    expect((await b.transactions.toArray())[0].amount).toBe(980);
    // 復元したデータも同期キューに載る
    expect(await b.outbox.count()).toBe(plan.toAdd.length);
  });

  it('同じバックアップを2回読み込んでも重複しない', async () => {
    const a = setActiveDb(`lifepartner-u-bk-c-${n}`);
    await createTask({ title: 'x' });
    const json = JSON.stringify(await buildBackup(a));
    const plan = await planImport(a, json);
    expect(plan.toAdd).toHaveLength(0);
    expect(plan.identical).toBeGreaterThan(0);
  });

  it('既存データは消えない・競合は既存優先が既定', async () => {
    const a = setActiveDb(`lifepartner-u-bk-d-${n}`);
    const t = await createTask({ title: '古い' });
    const json = JSON.stringify(await buildBackup(a));
    await updateRecord<Task>('tasks', t.id, { title: '新しい' });
    await createTask({ title: 'バックアップ後に追加' });
    const plan = await planImport(a, json);
    expect(plan.conflicts).toHaveLength(1);
    await applyImport(a, plan, 'keep-existing');
    expect((await a.tasks.get(t.id))?.title).toBe('新しい');
    expect(await a.tasks.count()).toBe(2);
    // バックアップの方が古いので newer-wins でも置き換えない
    await applyImport(a, plan, 'newer-wins');
    expect((await a.tasks.get(t.id))?.title).toBe('新しい');
  });

  it('復元を取り消せる', async () => {
    const a = setActiveDb(`lifepartner-u-bk-e-${n}`);
    await createTask({ title: 'A' });
    const json = JSON.stringify(await buildBackup(a));
    const b = setActiveDb(`lifepartner-u-bk-f-${n}`);
    await createTask({ title: 'B' });
    const plan = await planImport(b, json);
    await applyImport(b, plan, 'keep-existing');
    expect((await b.tasks.toArray()).filter((t) => !t.deleted)).toHaveLength(2);
    expect(await undoLastRestore(b)).toBe(true);
    const live = (await b.tasks.toArray()).filter((t) => !t.deleted);
    expect(live.map((t) => t.title)).toEqual(['B']);
  });

  it('不正なファイルを拒否する', async () => {
    const db = setActiveDb(`lifepartner-u-bk-g-${n}`);
    expect((await planImport(db, 'not json')).ok).toBe(false);
    expect((await planImport(db, JSON.stringify({ hello: 1 }))).ok).toBe(false);
    expect((await planImport(db, JSON.stringify({ app: 'life-partner', format: 99, tables: {} }))).ok).toBe(false);
    const bad = await planImport(
      db,
      JSON.stringify({
        app: 'life-partner',
        format: 1,
        tables: {
          transactions: [
            { id: 'x', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deleted: 0, type: 'expense', amount: -5, category: 'a', memo: '', date: '2026-01-01', fixedCostId: null, fixedCostPeriod: null },
            { id: 'y', createdAt: 'zzz' },
            '<script>',
          ],
          evilTable: [{ id: 1 }],
        },
      }),
    );
    expect(bad.ok).toBe(true);
    expect(bad.invalid).toHaveLength(3);
    expect(bad.toAdd).toHaveLength(0);
  });
});
