import {
  addMonths,
  dateInMonth,
  diffDays,
  parseDateStr,
  weekday,
  addDays,
  type DateStr,
  monthKey,
  toDateStr,
} from './date';
import type { FixedCost, Transaction, AppSettings } from '../db/types';

/**
 * 金銭計算。すべて円単位の整数で扱う。
 * ここに置く関数は純粋関数とし、単体テストで検証する（tests/unit/money.test.ts）。
 */

export const MAX_AMOUNT = 999_999_999;

/** 入力文字列を円の整数に変換。不正なら null */
export function parseYen(input: string | number): number | null {
  if (typeof input === 'number') {
    return Number.isSafeInteger(input) && input >= 0 && input <= MAX_AMOUNT ? input : null;
  }
  const normalized = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，円¥￥\s]/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isSafeInteger(n) || n > MAX_AMOUNT) return null;
  return n;
}

export function formatYen(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}${Math.abs(Math.trunc(n)).toLocaleString('ja-JP')}円`;
}

/** 給料日の実日付を計算（月末丸め・土日調整） */
export function paydayInMonth(
  y: number,
  m: number,
  day: number,
  rule: AppSettings['paydayWeekendRule'],
): DateStr {
  let d = dateInMonth(y, m, day);
  if (rule === 'none') return d;
  let w = weekday(d);
  let guard = 0;
  while ((w === 0 || w === 6) && guard++ < 3) {
    d = addDays(d, rule === 'before' ? -1 : 1);
    w = weekday(d);
  }
  return d;
}

export interface PayPeriod {
  /** 期間開始（直近の給料日。未設定時は月初） */
  start: DateStr;
  /** 次の給料日（この日は期間に含まない） */
  nextPayday: DateStr;
  /** 今日を含めた、次の給料日の前日までの日数（常に1以上） */
  daysRemaining: number;
  /** 次の給料日までの日数（給料日当日は0にならず、次回給料日までを数える） */
  daysUntilPayday: number;
  hasPayday: boolean;
}

/**
 * 給料サイクルを求める。
 * - 今日が給料日なら「今日から始まる新しいサイクル」として扱う（残り日数0による除算エラーを防ぐ）
 * - 給料日未設定なら暦月（次の給料日 = 翌月1日）として扱う
 */
export function getPayPeriod(
  todayStr: DateStr,
  paydayDay: number | null,
  rule: AppSettings['paydayWeekendRule'] = 'none',
): PayPeriod {
  const { y, m } = parseDateStr(todayStr);
  if (!paydayDay) {
    const start = dateInMonth(y, m, 1);
    const nextPayday = addMonths(start, 1);
    const days = diffDays(todayStr, nextPayday);
    return { start, nextPayday, daysRemaining: Math.max(1, days), daysUntilPayday: days, hasPayday: false };
  }
  // 前月・当月・翌月・翌々月の給料日候補から today を挟むものを探す
  const candidates: DateStr[] = [];
  for (let k = -1; k <= 2; k++) {
    const base = addMonths(dateInMonth(y, m, 1), k);
    const p = parseDateStr(base);
    candidates.push(paydayInMonth(p.y, p.m, paydayDay, rule));
  }
  let start = candidates[0];
  let next = candidates[1];
  for (let i = 0; i < candidates.length - 1; i++) {
    if (candidates[i] <= todayStr && todayStr < candidates[i + 1]) {
      start = candidates[i];
      next = candidates[i + 1];
      break;
    }
  }
  const days = diffDays(todayStr, next);
  return { start, nextPayday: next, daysRemaining: Math.max(1, days), daysUntilPayday: days, hasPayday: true };
}

/** 固定費の、指定期間内の支払予定日一覧 */
export function fixedCostDueDates(fc: FixedCost, from: DateStr, toExclusive: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const s = parseDateStr(from);
  let cursor = dateInMonth(s.y, s.m, 1);
  for (let i = 0; i < 14 && cursor < toExclusive; i++) {
    const c = parseDateStr(cursor);
    const due = dateInMonth(c.y, c.m, fc.dayOfMonth);
    if (due >= from && due < toExclusive) out.push(due);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

export interface UpcomingFixed {
  fixedCost: FixedCost;
  dueDate: DateStr;
  period: string; // YYYY-MM
  overdue: boolean;
}

/**
 * 現在の給料サイクル内で、まだ支払っていない固定費。
 * 支払済み（fixedCostId と期が一致する支出記録がある）ものは含めない → 二重差し引き防止。
 */
export function upcomingFixedCosts(
  fixedCosts: FixedCost[],
  transactions: Transaction[],
  period: PayPeriod,
  todayStr: DateStr,
): UpcomingFixed[] {
  const paid = new Set(
    transactions
      .filter((t) => !t.deleted && t.type === 'expense' && t.fixedCostId && t.fixedCostPeriod)
      .map((t) => `${t.fixedCostId}:${t.fixedCostPeriod}`),
  );
  const out: UpcomingFixed[] = [];
  for (const fc of fixedCosts) {
    if (fc.deleted || !fc.active) continue;
    // 登録より前の支払日は「登録時点で支払済み」とみなす（登録した日の分は含める）
    const registered = toDateStr(new Date(fc.createdAt));
    const from = registered > period.start ? registered : period.start;
    for (const due of fixedCostDueDates(fc, from, period.nextPayday)) {
      const key = `${fc.id}:${monthKey(due)}`;
      if (paid.has(key)) continue;
      out.push({ fixedCost: fc, dueDate: due, period: monthKey(due), overdue: due < todayStr });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}

/**
 * 現在の利用可能残高。
 * 基準残高（登録時点）＋ 登録後に記録された収入 − 登録後に記録された支出。
 * - 日付が未来の収入（未入金）は含めない
 * - 日付が未来の支出（予定）も含めない
 */
export function currentBalance(
  settings: Pick<AppSettings, 'balanceAmount' | 'balanceAsOf'>,
  transactions: Transaction[],
  todayStr: DateStr,
): number | null {
  if (settings.balanceAmount === null || settings.balanceAmount === undefined) return null;
  const asOf = settings.balanceAsOf ?? '';
  let bal = settings.balanceAmount;
  for (const t of transactions) {
    if (t.deleted) continue;
    if (t.createdAt <= asOf) continue;
    if (t.date > todayStr) continue;
    bal += t.type === 'income' ? t.amount : -t.amount;
  }
  return bal;
}

/** 予算期間内の変動費（固定費の支払を除く支出）合計 */
export function variableSpent(transactions: Transaction[], from: DateStr, toExclusive: DateStr): number {
  let s = 0;
  for (const t of transactions) {
    if (t.deleted || t.type !== 'expense' || t.fixedCostId) continue;
    if (t.date >= from && t.date < toExclusive) s += t.amount;
  }
  return s;
}

export function spentOn(transactions: Transaction[], day: DateStr): number {
  let s = 0;
  for (const t of transactions) {
    if (!t.deleted && t.type === 'expense' && !t.fixedCostId && t.date === day) s += t.amount;
  }
  return s;
}

export interface DailyAllowance {
  /** 今日使える金額（今日の支出を差し引く前の目安） */
  perDay: number;
  /** 今日すでに使った金額を差し引いた、今日の残り */
  todayRemaining: number;
  spentToday: number;
  /** 不足額（0以上） */
  shortfall: number;
  period: PayPeriod;
  balance: number | null;
  upcomingFixed: UpcomingFixed[];
  upcomingFixedTotal: number;
  reserve: number;
  /** 残高ベースで使える総額 */
  availableByBalance: number | null;
  budget: number | null;
  budgetSpent: number;
  budgetRemaining: number | null;
  /** どちらの制約で決まったか */
  limitedBy: 'balance' | 'budget' | 'none';
  /** 計算に必要な情報が不足している */
  missing: ('balance' | 'payday' | 'budget')[];
}

/**
 * 今日使える金額 =
 *   min( 現在の利用可能残高 − 今後支払う固定費 − 確保したい貯金額 , 予算残額 )
 *   ÷ 次の給料日までの残り日数（今日を含む）
 *
 * - 「今日の支出」は分子に含めて計算する（今日使った分で今日の目安額が変わらないよう、
 *    今日の開始時点の金額を基準にする）
 * - 残高不足時は 0 円とし、不足額を別に返す
 */
export function computeDailyAllowance(
  settings: Pick<AppSettings, 'balanceAmount' | 'balanceAsOf' | 'paydayDay' | 'paydayWeekendRule' | 'monthlyBudget' | 'reserveAmount'>,
  transactions: Transaction[],
  fixedCosts: FixedCost[],
  todayStr: DateStr,
): DailyAllowance {
  const period = getPayPeriod(todayStr, settings.paydayDay, settings.paydayWeekendRule);
  const balance = currentBalance(settings, transactions, todayStr);
  const upcoming = upcomingFixedCosts(fixedCosts, transactions, period, todayStr);
  const upcomingFixedTotal = upcoming.reduce((s, u) => s + u.fixedCost.amount, 0);
  const reserve = Math.max(0, Math.trunc(settings.reserveAmount || 0));
  const spentToday = spentOn(transactions, todayStr);

  const missing: DailyAllowance['missing'] = [];
  if (balance === null) missing.push('balance');
  if (!settings.paydayDay) missing.push('payday');
  if (settings.monthlyBudget === null || settings.monthlyBudget === undefined) missing.push('budget');

  // 今日の開始時点の残高（今日の変動費支出を戻す）
  const availableByBalance = balance === null ? null : balance + spentToday - upcomingFixedTotal - reserve;

  const budget = settings.monthlyBudget ?? null;
  const budgetSpent = variableSpent(transactions, period.start, period.nextPayday);
  const budgetSpentBeforeToday = budgetSpent - spentToday;
  const budgetRemaining = budget === null ? null : budget - budgetSpent;
  const budgetAvailableAtStartOfToday = budget === null ? null : budget - budgetSpentBeforeToday;

  let pool: number | null = null;
  let limitedBy: DailyAllowance['limitedBy'] = 'none';
  if (availableByBalance !== null && budgetAvailableAtStartOfToday !== null) {
    if (budgetAvailableAtStartOfToday < availableByBalance) {
      pool = budgetAvailableAtStartOfToday;
      limitedBy = 'budget';
    } else {
      pool = availableByBalance;
      limitedBy = 'balance';
    }
  } else if (availableByBalance !== null) {
    pool = availableByBalance;
    limitedBy = 'balance';
  } else if (budgetAvailableAtStartOfToday !== null) {
    pool = budgetAvailableAtStartOfToday;
    limitedBy = 'budget';
  }

  let perDay = 0;
  let shortfall = 0;
  if (pool !== null) {
    if (pool <= 0) {
      perDay = 0;
      shortfall = -pool;
    } else {
      perDay = Math.floor(pool / period.daysRemaining);
    }
  }
  // 残高ベースの不足（予算で制限されていても、残高自体が足りない場合は表示する）
  if (availableByBalance !== null && availableByBalance - spentToday < 0) {
    shortfall = Math.max(shortfall, -(availableByBalance - spentToday));
  }

  return {
    perDay,
    todayRemaining: Math.max(0, perDay - spentToday),
    spentToday,
    shortfall,
    period,
    balance,
    upcomingFixed: upcoming,
    upcomingFixedTotal,
    reserve,
    availableByBalance,
    budget,
    budgetSpent,
    budgetRemaining,
    limitedBy,
    missing,
  };
}

export interface MonthlySummary {
  month: string;
  income: number;
  expense: number;
  byCategory: { category: string; amount: number }[];
}

export function monthlySummary(transactions: Transaction[], month: string): MonthlySummary {
  let income = 0;
  let expense = 0;
  const cat = new Map<string, number>();
  for (const t of transactions) {
    if (t.deleted || monthKey(t.date) !== month) continue;
    if (t.type === 'income') income += t.amount;
    else {
      expense += t.amount;
      cat.set(t.category, (cat.get(t.category) ?? 0) + t.amount);
    }
  }
  return {
    month,
    income,
    expense,
    byCategory: [...cat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
  };
}

/** CSV（Excel/Numbers で文字化けしないよう BOM 付き UTF-8） */
export function transactionsToCsv(transactions: Transaction[], fixedCosts: FixedCost[]): string {
  const fcName = new Map(fixedCosts.map((f) => [f.id, f.name]));
  const esc = (v: string) => {
    // CSVインジェクション対策：先頭が = + - @ の場合は ' を付与
    let s = v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['日付', '種類', '金額', 'カテゴリー', 'メモ', '固定費', 'ID'];
  const rows = transactions
    .filter((t) => !t.deleted)
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1))
    .map((t) =>
      [
        t.date,
        t.type === 'income' ? '収入' : '支出',
        String(t.amount),
        esc(t.category),
        esc(t.memo),
        esc(t.fixedCostId ? fcName.get(t.fixedCostId) ?? '' : ''),
        t.id,
      ].join(','),
    );
  return '﻿' + [header.join(','), ...rows].join('\r\n') + '\r\n';
}
