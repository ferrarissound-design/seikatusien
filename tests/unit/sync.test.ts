import { describe, it, expect, beforeEach } from 'vitest';
import { setActiveDb, adoptDb, LifePartnerDB } from '../../src/db/db';
import { createRecord, updateRecord, softDelete } from '../../src/db/repo';
import { createTask, addTransaction } from '../../src/db/actions';
import { SyncEngine, pendingCount } from '../../src/sync/engine';
import type { Task, Transaction } from '../../src/db/types';
import { FakeServer } from './fakeServer';

let seq = 0;
let server: FakeServer;
const USER = 'user-a';

function device(name: string) {
  const db = adoptDb(new LifePartnerDB(`lifepartner-u-${name}-${seq}`));
  return { db, engine: new SyncEngine(db, server.transport(USER)) };
}
const use = (db: LifePartnerDB) => adoptDb(db);

beforeEach(() => {
  seq++;
  server = new FakeServer();
});

describe('同期エンジン', () => {
  it('オフラインで登録 → アプリ再起動 → 通信復帰で送信される', async () => {
    const a = device('a');
    server.failBeforeApply = true;
    const t = await createTask({ title: '書類を出す' });
    const r1 = await a.engine.sync();
    expect(r1.error).toBeTruthy();
    expect(await pendingCount(a.db)).toBe(1);

    // 再起動（DBを閉じて開き直す）
    const name = a.db.name;
    a.db.close();
    const db2 = setActiveDb(name);
    expect(await db2.outbox.count()).toBe(1);
    server.failBeforeApply = false;
    const r2 = await new SyncEngine(db2, server.transport(USER)).sync();
    expect(r2.error).toBeNull();
    expect(await pendingCount(db2)).toBe(0);
    expect(server.get(USER, 'tasks', t.id)?.data.title).toBe('書類を出す');
    expect((await db2.tasks.get(t.id))?.serverVersion).toBe(1);
  });

  it('保存後に応答が失われても、再送で二重登録・二重更新しない', async () => {
    const a = device('a');
    const tx = await addTransaction({ type: 'expense', amount: 500, category: '食費' });
    server.dropResponse = true;
    await a.engine.sync();
    expect(await pendingCount(a.db)).toBe(1); // 応答を確認できていないので未同期のまま
    expect(server.get(USER, 'transactions', tx.id)?.version).toBe(1);
    server.dropResponse = false;
    await a.engine.sync();
    expect(await pendingCount(a.db)).toBe(0);
    expect(server.get(USER, 'transactions', tx.id)?.version).toBe(1);
    expect(server.countFor(USER, 'transactions')).toBe(1);
    expect(await a.db.conflicts.count()).toBe(0);
  });

  it('同じデータを何度同期しても重複しない', async () => {
    const a = device('a');
    await addTransaction({ type: 'expense', amount: 300, category: 'コンビニ' });
    for (let i = 0; i < 5; i++) await a.engine.sync();
    expect(server.countFor(USER, 'transactions')).toBe(1);
    expect(await a.db.transactions.count()).toBe(1);
  });

  it('別端末（機種変更・再インストール）で復元できる', async () => {
    const a = device('a');
    const t = await createTask({ title: '歯医者の予約' });
    await addTransaction({ type: 'income', amount: 1000, category: 'その他' });
    await a.engine.sync();

    const b = device('b');
    await b.engine.sync();
    expect((await b.db.tasks.get(t.id))?.title).toBe('歯医者の予約');
    expect(await b.db.transactions.count()).toBe(1);
    expect(await pendingCount(b.db)).toBe(0);
  });

  it('削除も同期される', async () => {
    const a = device('a');
    const t = await createTask({ title: '消すタスク' });
    await a.engine.sync();
    const b = device('b');
    await b.engine.sync();

    use(a.db);
    await softDelete('tasks', t.id);
    await a.engine.sync();
    use(b.db);
    await b.engine.sync();
    expect((await b.db.tasks.get(t.id))?.deleted).toBe(1);
  });

  it('未送信の変更がある記録は、取得で上書きされない', async () => {
    const a = device('a');
    const t = await createTask({ title: '元' });
    await a.engine.sync();
    const b = device('b');
    await b.engine.sync();

    use(a.db);
    await updateRecord<Task>('tasks', t.id, { title: 'Aの変更' });
    await a.engine.sync();

    use(b.db);
    server.failBeforeApply = true; // B は送信できないが取得はできる状況
    await updateRecord<Task>('tasks', t.id, { notes: 'Bのメモ' });
    await b.engine.sync().catch(() => undefined);
    expect((await b.db.tasks.get(t.id))?.notes).toBe('Bのメモ');
  });

  it('タスクの競合：新しい方を採用し、もう一方は競合履歴に残る', async () => {
    const a = device('a');
    const t = await createTask({ title: '元' });
    await a.engine.sync();
    const b = device('b');
    await b.engine.sync();

    use(a.db);
    await updateRecord<Task>('tasks', t.id, { title: 'Aの変更' });
    await a.engine.sync();

    use(b.db);
    await new Promise((r) => setTimeout(r, 5));
    await updateRecord<Task>('tasks', t.id, { title: 'Bの変更（後）' });
    const r = await b.engine.sync();
    expect(r.conflicts).toBe(1);
    expect(server.get(USER, 'tasks', t.id)?.data.title).toBe('Bの変更（後）');
    const c = await b.db.conflicts.toArray();
    expect(c[0].status).toBe('auto-resolved');
    expect(c[0].server?.title).toBe('Aの変更');

    use(a.db);
    await a.engine.sync();
    expect((await a.db.tasks.get(t.id))?.title).toBe('Bの変更（後）');
  });

  it('金銭記録の競合は黙って破棄せず、確認待ちにする → 両方残せる', async () => {
    const a = device('a');
    const tx = await addTransaction({ type: 'expense', amount: 1000, category: '食費' });
    await a.engine.sync();
    const b = device('b');
    await b.engine.sync();

    use(a.db);
    await updateRecord<Transaction>('transactions', tx.id, { amount: 1200 });
    await a.engine.sync();

    use(b.db);
    await updateRecord<Transaction>('transactions', tx.id, { amount: 1500 });
    await b.engine.sync();
    const pending = await b.db.conflicts.where('status').equals('pending').toArray();
    expect(pending).toHaveLength(1);
    expect(server.get(USER, 'transactions', tx.id)?.data.amount).toBe(1200); // サーバーは上書きされない
    expect((await b.db.transactions.get(tx.id))?.amount).toBe(1500); // 端末の入力も消えない
    expect((await b.db.outbox.toArray())[0].blocked).toBe(1);

    await b.engine.resolveConflict(pending[0].id, 'both');
    await b.engine.sync();
    const amounts = (await b.db.transactions.toArray()).map((x) => x.amount).sort();
    expect(amounts).toEqual([1200, 1500]);
    expect(server.countFor(USER, 'transactions')).toBe(2);
    expect(await pendingCount(b.db)).toBe(0);
  });

  it('金銭記録の競合：端末の内容を採用', async () => {
    const a = device('a');
    const tx = await addTransaction({ type: 'expense', amount: 1000, category: '食費' });
    await a.engine.sync();
    const b = device('b');
    await b.engine.sync();
    use(a.db);
    await updateRecord<Transaction>('transactions', tx.id, { amount: 1200 });
    await a.engine.sync();
    use(b.db);
    await updateRecord<Transaction>('transactions', tx.id, { amount: 1500 });
    await b.engine.sync();
    const [c] = await b.db.conflicts.toArray();
    await b.engine.resolveConflict(c.id, 'local');
    await b.engine.sync();
    expect(server.get(USER, 'transactions', tx.id)?.data.amount).toBe(1500);
    expect(server.countFor(USER, 'transactions')).toBe(1);
  });

  it('送信中に通信が切れ、その間に再編集しても最新内容が届く', async () => {
    const a = device('a');
    const t = await createRecord<Task>('tasks', {
      title: 'v1', notes: '', dueDate: null, dueTime: null, priority: 2, category: '', done: 0, doneAt: null,
      recurrence: { kind: 'none' }, carriedFrom: null, sortOrder: 0, seriesId: null,
    });
    server.dropResponse = true;
    await a.engine.sync();
    await updateRecord<Task>('tasks', t.id, { title: 'v2' });
    server.dropResponse = false;
    await a.engine.sync();
    expect(server.get(USER, 'tasks', t.id)?.data.title).toBe('v2');
    expect(await pendingCount(a.db)).toBe(0);
    expect(await a.db.conflicts.count()).toBe(0);
  });

  it('他のユーザーのデータは取得されない', async () => {
    device('a');
    await createTask({ title: 'Aの秘密' });
    const a = device('a2');
    await createTask({ title: 'Aの秘密2' });
    await a.engine.sync();
    const otherDb = adoptDb(new LifePartnerDB(`lifepartner-u-other-${seq}`));
    const other = new SyncEngine(otherDb, server.transport('user-b'));
    await other.sync();
    expect(await otherDb.tasks.count()).toBe(0);
  });
});
