import { getDb } from './db';
import { createRecord, updateRecord, softDelete, restore, bulkUpdate, getSettings, saveSettings, describeSaveError } from './repo';
import type { Checklist, CheckItem, CheckHistory, Task, Subtask, Transaction, FixedCost, TemplateType, Recurrence, WeightEntry } from './types';
import { BUILTIN_TEMPLATES, TEMPLATE_LABELS } from './templates';
import { logicalDate, today, addDays, type DateStr } from '../lib/date';
import { nextOccurrence } from '../lib/recurrence';
import { nowIso } from '../lib/id';
import { emit, toast } from '../lib/events';

// ====================== 忘れ物チェック ======================

export async function createChecklist(name: string, templateType: TemplateType, items?: string[], fromTemplateId?: string) {
  const db = getDb();
  const count = await db.checklists.filter((c) => !c.deleted).count();
  const list = await createRecord<Checklist>('checklists', {
    name: name.trim() || TEMPLATE_LABELS[templateType],
    templateType,
    resetTime: '04:00',
    lastResetDate: logicalDate(new Date(), '04:00'),
    sortOrder: count,
    showOnHome: 1,
    isTemplate: 0,
  });
  let labels = items;
  if (!labels && fromTemplateId) {
    labels = (await activeItems(fromTemplateId)).map((i) => i.label);
  }
  if (!labels && templateType !== 'custom') labels = BUILTIN_TEMPLATES[templateType];
  for (const [i, label] of (labels ?? []).entries()) {
    await createRecord<CheckItem>('checkItems', { checklistId: list.id, label, checked: 0, sortOrder: i });
  }
  return list;
}

export async function saveAsTemplate(checklistId: string, name: string) {
  const db = getDb();
  const src = await db.checklists.get(checklistId);
  if (!src) return;
  const items = await activeItems(checklistId);
  const tpl = await createRecord<Checklist>('checklists', {
    name: name.trim() || `${src.name}のテンプレート`,
    templateType: 'custom',
    resetTime: null,
    lastResetDate: null,
    sortOrder: 0,
    showOnHome: 0,
    isTemplate: 1,
  });
  for (const [i, it] of items.entries()) {
    await createRecord<CheckItem>('checkItems', { checklistId: tpl.id, label: it.label, checked: 0, sortOrder: i });
  }
  return tpl;
}

export async function activeItems(checklistId: string): Promise<CheckItem[]> {
  const items = await getDb().checkItems.where('checklistId').equals(checklistId).toArray();
  return items.filter((i) => !i.deleted).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function addCheckItem(checklistId: string, label: string) {
  const items = await activeItems(checklistId);
  const max = items.reduce((m, i) => Math.max(m, i.sortOrder), -1);
  return createRecord<CheckItem>('checkItems', { checklistId, label: label.trim(), checked: 0, sortOrder: max + 1 });
}

export async function toggleCheckItem(item: CheckItem) {
  const checked = item.checked ? 0 : 1;
  await updateRecord<CheckItem>('checkItems', item.id, { checked });
  if (checked) await recordCompletionIfDone(item.checklistId);
}

async function recordCompletionIfDone(checklistId: string) {
  const db = getDb();
  const list = await db.checklists.get(checklistId);
  if (!list) return;
  const items = await activeItems(checklistId);
  if (items.length === 0 || !items.every((i) => i.checked)) return;
  const date = logicalDate(new Date(), list.resetTime);
  await putHistory(list, items, date, 'complete');
}

/** 決定的IDで履歴を保存（複数端末で同じ日の履歴が重複しないように） */
async function putHistory(list: Checklist, items: CheckItem[], date: DateStr, reason: CheckHistory['reason']) {
  const db = getDb();
  const id = `h:${list.id}:${date}`;
  const existing = await db.checkHistory.get(id);
  const data = {
    checklistId: list.id,
    checklistName: list.name,
    date,
    checkedCount: items.filter((i) => i.checked).length,
    totalCount: items.length,
    items: items.map((i) => ({ label: i.label, checked: !!i.checked })),
    reason,
  };
  if (existing) {
    // 完了記録の方が情報が多い場合は残す
    if (existing.reason === 'complete' && reason === 'reset' && existing.checkedCount >= data.checkedCount) return;
    await updateRecord<CheckHistory>('checkHistory', id, data);
  } else {
    await createRecord<CheckHistory>('checkHistory', { id, ...data });
  }
}

export async function resetChecklistNow(checklistId: string) {
  const db = getDb();
  const list = await db.checklists.get(checklistId);
  if (!list) return;
  const items = await activeItems(checklistId);
  const date = logicalDate(new Date(), list.resetTime);
  if (items.some((i) => i.checked)) await putHistory(list, items, date, 'manual');
  const checkedIds = items.filter((i) => i.checked).map((i) => i.id);
  await bulkUpdate('checkItems', checkedIds.map((id) => ({ id, changes: { checked: 0 } })));
  toast('チェックをすべて外しました', async () => {
    await bulkUpdate('checkItems', checkedIds.map((id) => ({ id, changes: { checked: 1 } })));
  });
}

/**
 * 自動リセット。起動時・画面復帰時・1分ごとに呼ぶ。
 * アプリを起動していない間に日付が変わっていた場合も、次回起動時に処理される。
 * 何日分空いていても履歴は「最後に使った日」の1件のみ（間の日はチェックが発生していないため）。
 */
export async function runChecklistResets(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const lists = await db.checklists.filter((c) => !c.deleted && !c.isTemplate && !!c.resetTime).toArray();
  let resetCount = 0;
  for (const list of lists) {
    const ld = logicalDate(now, list.resetTime);
    if (list.lastResetDate === ld) continue;
    if (list.lastResetDate && list.lastResetDate > ld) continue; // 端末時刻が戻った場合は何もしない
    const items = await activeItems(list.id);
    const checked = items.filter((i) => i.checked);
    if (list.lastResetDate && checked.length > 0) {
      await putHistory(list, items, list.lastResetDate, 'reset');
    }
    if (checked.length) {
      await bulkUpdate('checkItems', checked.map((i) => ({ id: i.id, changes: { checked: 0 } })));
    }
    await updateRecord<Checklist>('checklists', list.id, { lastResetDate: ld });
    resetCount++;
  }
  return resetCount;
}

export async function reorder(table: 'checkItems' | 'checklists' | 'tasks' | 'subtasks', ids: string[]) {
  await bulkUpdate(table, ids.map((id, i) => ({ id, changes: { sortOrder: i } })));
}

export async function deleteWithUndo(table: Parameters<typeof softDelete>[0], ids: string | string[], label: string) {
  await softDelete(table, ids);
  toast(`${label}を削除しました`, () => restore(table, ids));
}

// ====================== タスク ======================

export async function createTask(data: Partial<Task> & { title: string }) {
  const db = getDb();
  const count = await db.tasks.filter((t) => !t.deleted && !t.done).count();
  const recurrence: Recurrence = data.recurrence ?? { kind: 'none' };
  return createRecord<Task>('tasks', {
    title: data.title.trim(),
    notes: data.notes ?? '',
    dueDate: data.dueDate ?? (recurrence.kind !== 'none' ? today() : null),
    dueTime: data.dueTime ?? null,
    priority: data.priority ?? 2,
    category: data.category ?? '',
    done: 0,
    doneAt: null,
    recurrence,
    carriedFrom: null,
    sortOrder: data.sortOrder ?? count,
    seriesId: data.seriesId ?? null,
  });
}

/** 繰り返しタスクの次回分のID（決定的に決めて、複数端末での重複生成を防ぐ） */
export function nextInstanceId(task: Task, nextDate: DateStr) {
  return `r:${task.seriesId ?? task.id}:${nextDate}`;
}

export async function setTaskDone(task: Task, done: boolean) {
  const db = getDb();
  await updateRecord<Task>('tasks', task.id, { done: done ? 1 : 0, doneAt: done ? nowIso() : null });
  if (task.recurrence.kind === 'none') return;
  const base = task.dueDate ?? today();
  // 期限を過ぎてから完了した場合でも、次回は今日より後の日付にする
  let next = nextOccurrence(task.recurrence, base);
  let guard = 0;
  while (next && next <= today() && guard++ < 400) next = nextOccurrence(task.recurrence, next);
  if (!next) return;
  const id = nextInstanceId(task, next);
  const existing = await db.tasks.get(id);
  if (done) {
    if (existing) {
      if (existing.deleted) await restore('tasks', id);
      return;
    }
    const subs = await activeSubtasks(task.id);
    await createRecord<Task>('tasks', {
      id,
      title: task.title,
      notes: task.notes,
      dueDate: next,
      dueTime: task.dueTime,
      priority: task.priority,
      category: task.category,
      done: 0,
      doneAt: null,
      recurrence: task.recurrence,
      carriedFrom: null,
      sortOrder: task.sortOrder,
      seriesId: task.seriesId ?? task.id,
    });
    for (const s of subs) {
      await createRecord<Subtask>('subtasks', { taskId: id, title: s.title, done: 0, sortOrder: s.sortOrder });
    }
  } else if (existing && !existing.deleted && !existing.done && existing.createdAt === existing.updatedAt) {
    // 完了を取り消した場合、まだ手を付けていない次回分は取り下げる
    await softDelete('tasks', id);
  }
}

export async function activeSubtasks(taskId: string): Promise<Subtask[]> {
  const subs = await getDb().subtasks.where('taskId').equals(taskId).toArray();
  return subs.filter((s) => !s.deleted).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function addSubtask(taskId: string, title: string) {
  const subs = await activeSubtasks(taskId);
  return createRecord<Subtask>('subtasks', {
    taskId,
    title: title.trim(),
    done: 0,
    sortOrder: subs.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1,
  });
}

export async function postponeTask(task: Task, days = 1) {
  const base = today();
  await updateRecord<Task>('tasks', task.id, {
    dueDate: addDays(base, days),
    carriedFrom: task.carriedFrom ?? task.dueDate ?? base,
  });
  toast(days === 1 ? '明日に回しました' : `${days}日後に回しました`, () =>
    updateRecord<Task>('tasks', task.id, { dueDate: task.dueDate, carriedFrom: task.carriedFrom }),
  );
}

/**
 * 未完了タスクの自動繰り越し。期限が過ぎた未完了タスクを今日に移す。
 * 「できなかった」とは表示せず「◯日から繰り越し」として扱う。
 */
export async function runTaskRollover(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const settings = await getSettings(db);
  if (!settings.taskRollover) return 0;
  const t = today(now);
  const overdue = await db.tasks.filter((x) => !x.deleted && !x.done && !!x.dueDate && x.dueDate < t).toArray();
  if (!overdue.length) return 0;
  await bulkUpdate(
    'tasks',
    overdue.map((x) => ({ id: x.id, changes: { dueDate: t, carriedFrom: x.carriedFrom ?? x.dueDate } })),
  );
  return overdue.length;
}

// ====================== お金 ======================

export async function addTransaction(data: {
  type: Transaction['type'];
  amount: number;
  category: string;
  memo?: string;
  date?: DateStr;
  fixedCostId?: string | null;
  fixedCostPeriod?: string | null;
}) {
  if (!Number.isSafeInteger(data.amount) || data.amount <= 0) throw new Error('invalid amount');
  return createRecord<Transaction>('transactions', {
    type: data.type,
    amount: data.amount,
    category: data.category,
    memo: data.memo?.trim() ?? '',
    date: data.date ?? today(),
    fixedCostId: data.fixedCostId ?? null,
    fixedCostPeriod: data.fixedCostPeriod ?? null,
  });
}

export async function quickExpense(amount: number, category: string, memo = '') {
  try {
    const tx = await addTransaction({ type: 'expense', amount, category, memo });
    toast(`${category} ${amount.toLocaleString('ja-JP')}円を記録しました`, () => softDelete('transactions', tx.id));
    return tx;
  } catch (e) {
    emit({ type: 'save-error', message: describeSaveError(e) });
    throw e;
  }
}

export async function markFixedCostPaid(fc: FixedCost, period: string, date: DateStr = today()) {
  const db = getDb();
  // 同じ期の支払記録が既にある場合は二重登録しない
  const dup = await db.transactions
    .where('fixedCostId')
    .equals(fc.id)
    .filter((t) => !t.deleted && t.fixedCostPeriod === period)
    .first();
  if (dup) return dup;
  const tx = await addTransaction({
    type: 'expense',
    amount: fc.amount,
    category: fc.category || '固定費',
    memo: fc.name,
    date,
    fixedCostId: fc.id,
    fixedCostPeriod: period,
  });
  toast(`${fc.name}を支払済みにしました`, () => softDelete('transactions', tx.id));
  return tx;
}

/** 現在の残高を登録し直す（以降の記録はこの金額を基準に増減） */
export async function setBalance(amount: number) {
  await saveSettings({ balanceAmount: amount, balanceAsOf: nowIso() });
}

// ====================== 体重 ======================

export async function addWeight(data: { weightCg: number; date?: DateStr; time?: string | null; memo?: string }) {
  if (!Number.isSafeInteger(data.weightCg) || data.weightCg < 100 || data.weightCg > 50000) throw new Error('invalid weight');
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return createRecord<WeightEntry>('weights', {
    date: data.date ?? today(),
    time: data.time === undefined ? hhmm : data.time,
    weightCg: data.weightCg,
    memo: (data.memo ?? '').trim().slice(0, 1000),
  });
}
