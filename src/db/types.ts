import type { DateStr } from '../lib/date';

/**
 * 同期対象レコードの共通フィールド。
 * - id: クライアント生成の UUID（重複登録防止・オフライン作成対応）
 * - createdAt / updatedAt: ISO8601（端末時刻）
 * - serverVersion: サーバーで確認済みのバージョン（0 = 未同期の新規）
 * - deleted: 削除フラグ（トゥームストーン）。削除も同期するため物理削除しない
 */
export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  serverVersion: number;
  deleted: 0 | 1;
}

export type TemplateType = 'work' | 'school' | 'shopping' | 'hospital' | 'travel' | 'outing' | 'custom';

export interface Checklist extends BaseRecord {
  name: string;
  templateType: TemplateType;
  /** 自動リセット時刻 "HH:MM"。null ならリセットしない */
  resetTime: string | null;
  /** 最後にリセット処理を行った論理日付 */
  lastResetDate: DateStr | null;
  sortOrder: number;
  /** ホームに表示するか */
  showOnHome: 0 | 1;
  /** 利用者独自のテンプレート（一覧には出さず、新規作成時の雛形として使う） */
  isTemplate?: 0 | 1;
}

export interface CheckItem extends BaseRecord {
  checklistId: string;
  label: string;
  checked: 0 | 1;
  sortOrder: number;
}

/** 過去のチェック履歴（リセット時・全完了時に記録。削除しない） */
export interface CheckHistory extends BaseRecord {
  checklistId: string;
  checklistName: string;
  date: DateStr;
  checkedCount: number;
  totalCount: number;
  items: { label: string; checked: boolean }[];
  reason: 'reset' | 'complete' | 'manual';
}

export type Priority = 1 | 2 | 3; // 1=高 2=中 3=低

export type Recurrence =
  | { kind: 'none' }
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] } // 0=日..6=土
  | { kind: 'monthly'; day: number };

export interface Task extends BaseRecord {
  title: string;
  notes: string;
  dueDate: DateStr | null;
  dueTime: string | null;
  priority: Priority;
  category: string;
  done: 0 | 1;
  doneAt: string | null;
  recurrence: Recurrence;
  /** 繰り越し回数（責めるためではなく、表示上「◯日から」を示すため） */
  carriedFrom: DateStr | null;
  sortOrder: number;
  /** 繰り返しタスクから生成された場合の元ID */
  seriesId: string | null;
}

export interface Subtask extends BaseRecord {
  taskId: string;
  title: string;
  done: 0 | 1;
  sortOrder: number;
}

export type TxType = 'income' | 'expense';

export interface Transaction extends BaseRecord {
  type: TxType;
  /** 円単位の整数 */
  amount: number;
  category: string;
  memo: string;
  date: DateStr;
  /** 固定費の支払記録の場合、その固定費ID */
  fixedCostId: string | null;
  /** 固定費の支払対象期（YYYY-MM） */
  fixedCostPeriod: string | null;
}

export interface FixedCost extends BaseRecord {
  name: string;
  amount: number;
  /** 毎月の支払日（1-31、月末を超えたら月末） */
  dayOfMonth: number;
  category: string;
  active: 0 | 1;
}

export interface SavingsGoal extends BaseRecord {
  name: string;
  targetAmount: number;
  savedAmount: number;
}

export type ReminderKind = 'checklist' | 'taskDue' | 'recurringTask' | 'payment' | 'payday' | 'expenseLog';

export interface Reminder extends BaseRecord {
  kind: ReminderKind;
  label: string;
  /** "HH:MM" */
  time: string;
  /** 対象曜日（空 = 毎日） */
  weekdays: number[];
  targetId: string | null;
  enabled: 0 | 1;
}

export interface AppSettings extends BaseRecord {
  // id は常に 'settings'
  features: { checklists: boolean; tasks: boolean; money: boolean; weight: boolean };
  /** 給料日（1-31）。null = 未設定 */
  paydayDay: number | null;
  /** 給料日が土日の場合の扱い */
  paydayWeekendRule: 'none' | 'before' | 'after';
  /** 利用可能残高の基準 */
  balanceAmount: number | null;
  balanceAsOf: string | null;
  /** 予算期間あたりの変動費予算（null = 未設定） */
  monthlyBudget: number | null;
  /** 給料日までに確保したい貯金額 */
  reserveAmount: number;
  expenseCategories: string[];
  taskCategories: string[];
  theme: 'system' | 'light' | 'dark';
  reduceMotion: 'system' | 'on' | 'off';
  fontScale: 1 | 1.15 | 1.3;
  taskRollover: boolean;
  onboardingDone: boolean;
  timezone: string;
}

/**
 * 体重の記録。健康管理を自分で行うための記録で、判定（BMI・目標）は行わない。
 * 小数の誤差を避けるため、0.01kg 単位の整数（センチキログラム）で保存する。
 * 例：65.45kg → weightCg = 6545
 */
export interface WeightEntry extends BaseRecord {
  date: DateStr;
  /** "HH:MM"。記録した時刻（同じ日に複数回測る人のため）。不明なら null */
  time: string | null;
  weightCg: number;
  memo: string;
}

export const SYNC_TABLES = [
  'checklists',
  'checkItems',
  'checkHistory',
  'tasks',
  'subtasks',
  'transactions',
  'fixedCosts',
  'savingsGoals',
  'reminders',
  'settings',
  'weights',
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/** 競合時に自動解決せず利用者の確認を必要とするテーブル（金銭記録） */
export const MONEY_TABLES: readonly SyncTable[] = ['transactions', 'fixedCosts', 'savingsGoals'];

// ---- 端末ローカル専用（同期しない）----

/** 未同期の変更キュー（永続） */
export interface OutboxEntry {
  seq?: number; // auto increment
  opId: string;
  table: SyncTable;
  recordId: string;
  enqueuedAt: string;
  /** 送信を試みた時刻。送信後はペイロードを固定し、同じ opId で再送する */
  sentAt: string | null;
  baseVersion: number | null;
  payload: Record<string, unknown> | null;
  deleted: 0 | 1;
  attempts: number;
  lastError: string | null;
  /** 競合のため保留中 */
  blocked: 0 | 1;
}

export interface Conflict {
  id: string;
  table: SyncTable;
  recordId: string;
  detectedAt: string;
  local: Record<string, unknown>;
  server: Record<string, unknown> | null;
  serverVersion: number;
  status: 'pending' | 'auto-resolved' | 'resolved';
  resolution: 'local' | 'server' | 'both' | null;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export interface InAppNotice {
  id: string;
  key: string; // 重複表示防止キー（例 reminderId:date）
  title: string;
  body: string;
  createdAt: string;
  read: 0 | 1;
}
