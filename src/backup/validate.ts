import type { SyncTable } from '../db/types';
import { isValidDateStr, isValidTime } from '../lib/date';
import { isValidRecurrence } from '../lib/recurrence';
import { MAX_AMOUNT } from '../lib/money';

/**
 * バックアップ／同期で受け取るレコードの検証。
 * 外部から来たデータは信用せず、型と値の範囲を確認してから保存する。
 */

type Check = (v: unknown) => boolean;

const str = (max = 2000): Check => (v) => typeof v === 'string' && v.length <= max;
const nullable = (c: Check): Check => (v) => v === null || v === undefined || c(v);
const optional = nullable;
const flag: Check = (v) => v === 0 || v === 1;
const int = (min: number, max: number): Check => (v) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const amount: Check = int(0, MAX_AMOUNT);
const positiveAmount: Check = int(1, MAX_AMOUNT);
const date: Check = isValidDateStr;
const time: Check = isValidTime;
const iso: Check = (v) => typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v));
const oneOf = (...vals: unknown[]): Check => (v) => vals.includes(v);
const arrayOf = (c: Check, max = 1000): Check => (v) => Array.isArray(v) && v.length <= max && v.every(c);

const base: Record<string, Check> = {
  id: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 200,
  createdAt: iso,
  updatedAt: iso,
  deleted: flag,
};

const schemas: Record<SyncTable, Record<string, Check>> = {
  checklists: {
    name: str(200),
    templateType: oneOf('work', 'school', 'shopping', 'hospital', 'travel', 'outing', 'custom'),
    resetTime: nullable(time),
    lastResetDate: nullable(date),
    sortOrder: int(-1e6, 1e6),
    showOnHome: optional(flag),
    isTemplate: optional(flag),
  },
  checkItems: { checklistId: str(200), label: str(200), checked: flag, sortOrder: int(-1e6, 1e6) },
  checkHistory: {
    checklistId: str(200),
    checklistName: str(200),
    date,
    checkedCount: int(0, 10000),
    totalCount: int(0, 10000),
    items: arrayOf((i) => !!i && typeof i === 'object' && typeof (i as { label: unknown }).label === 'string'),
    reason: oneOf('reset', 'complete', 'manual'),
  },
  tasks: {
    title: str(500),
    notes: str(5000),
    dueDate: nullable(date),
    dueTime: nullable(time),
    priority: oneOf(1, 2, 3),
    category: str(100),
    done: flag,
    doneAt: nullable(iso),
    recurrence: isValidRecurrence,
    carriedFrom: nullable(date),
    sortOrder: int(-1e6, 1e6),
    seriesId: nullable(str(200)),
  },
  subtasks: { taskId: str(200), title: str(500), done: flag, sortOrder: int(-1e6, 1e6) },
  transactions: {
    type: oneOf('income', 'expense'),
    amount: positiveAmount,
    category: str(100),
    memo: str(1000),
    date,
    fixedCostId: nullable(str(200)),
    fixedCostPeriod: nullable((v) => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)),
  },
  fixedCosts: { name: str(200), amount, dayOfMonth: int(1, 31), category: str(100), active: flag },
  savingsGoals: { name: str(200), targetAmount: amount, savedAmount: amount },
  reminders: {
    kind: oneOf('checklist', 'taskDue', 'recurringTask', 'payment', 'payday', 'expenseLog'),
    label: str(200),
    time,
    weekdays: arrayOf(int(0, 6), 7),
    targetId: nullable(str(200)),
    enabled: flag,
  },
  settings: {
    features: (v) => !!v && typeof v === 'object',
    paydayDay: nullable(int(1, 31)),
    balanceAmount: nullable(int(-MAX_AMOUNT, MAX_AMOUNT)),
    balanceAsOf: nullable(iso),
    monthlyBudget: nullable(amount),
    reserveAmount: optional(amount),
    expenseCategories: optional(arrayOf(str(100), 100)),
    taskCategories: optional(arrayOf(str(100), 100)),
  },
};

export function validateRecord(table: SyncTable, rec: unknown): string | null {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'レコードの形式が正しくありません';
  const r = rec as Record<string, unknown>;
  for (const [k, c] of Object.entries(base)) {
    if (!c(r[k])) return `${k} が不正です`;
  }
  const schema = schemas[table];
  if (!schema) return '不明なデータ種別です';
  for (const [k, c] of Object.entries(schema)) {
    if (!c(r[k])) return `${k} が不正です`;
  }
  if (JSON.stringify(r).length > 100_000) return 'レコードが大きすぎます';
  return null;
}
