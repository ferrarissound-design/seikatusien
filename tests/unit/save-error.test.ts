import { describe, it, expect } from 'vitest';
import { setActiveDb } from '../../src/db/db';
import { createTask } from '../../src/db/actions';
import { subscribe, type AppEvent } from '../../src/lib/events';
import { describeSaveError } from '../../src/db/repo';

describe('保存失敗', () => {
  it('容量不足で保存できないとき、利用者に通知し、同期キューにも残さない', async () => {
    const db = setActiveDb('lifepartner-u-save-error');
    let fail = true;
    // IndexedDB 層（DBCore）で容量不足エラーを発生させる
    db.use({
      stack: 'dbcore',
      name: 'quota-fail',
      create: (down) => ({
        ...down,
        table: (name) => {
          const t = down.table(name);
          return {
            ...t,
            mutate: (req) => {
              if (fail && name === 'tasks') {
                fail = false;
                return Promise.reject(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
              }
              return t.mutate(req);
            },
          };
        },
      }),
    });
    await db.open();
    const events: AppEvent[] = [];
    const off = subscribe((e) => events.push(e));
    await expect(createTask({ title: '保存できない' })).rejects.toBeTruthy();
    off();
    const e = events.find((x) => x.type === 'save-error');
    expect(e && 'message' in e && e.message).toContain('空き容量');
    // トランザクションごと取り消され、中途半端な状態が残らない
    expect(await db.tasks.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
  it('エラーメッセージに入力内容を含めない', () => {
    expect(describeSaveError(new Error('タスク: 秘密の内容'))).not.toContain('秘密');
  });
});
