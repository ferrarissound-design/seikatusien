import { describe, it, expect } from 'vitest';
import {
  computeDailyAllowance,
  getPayPeriod,
  parseYen,
  upcomingFixedCosts,
  currentBalance,
  monthlySummary,
  transactionsToCsv,
  paydayInMonth,
} from '../../src/lib/money';
import type { FixedCost, Transaction } from '../../src/db/types';

// すべて架空のデータ
let n = 0;
const ASOF = '2026-11-01T00:00:00.000Z';
function tx(p: Partial<Transaction>): Transaction {
  n++;
  return {
    id: `t${n}`,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    serverVersion: 0,
    deleted: 0,
    type: 'expense',
    amount: 1000,
    category: '食費',
    memo: '',
    date: '2026-11-10',
    fixedCostId: null,
    fixedCostPeriod: null,
    ...p,
  };
}
function fc(p: Partial<FixedCost>): FixedCost {
  n++;
  return {
    id: `f${n}`,
    createdAt: ASOF,
    updatedAt: ASOF,
    serverVersion: 0,
    deleted: 0,
    name: '家賃',
    amount: 50000,
    dayOfMonth: 27,
    category: '住居',
    active: 1,
    ...p,
  };
}
const baseSettings = {
  balanceAmount: 100000,
  balanceAsOf: ASOF,
  paydayDay: 25,
  paydayWeekendRule: 'none' as const,
  monthlyBudget: null,
  reserveAmount: 0,
};

describe('parseYen', () => {
  it('全角・カンマ・円記号を受け付ける', () => {
    expect(parseYen('１，２３４円')).toBe(1234);
    expect(parseYen('¥5,000')).toBe(5000);
    expect(parseYen('12.5')).toBeNull();
    expect(parseYen('-100')).toBeNull();
    expect(parseYen('')).toBeNull();
    expect(parseYen('9999999999')).toBeNull();
  });
});

describe('給料サイクル', () => {
  it('給料日前', () => {
    const p = getPayPeriod('2026-11-20', 25);
    expect(p.start).toBe('2026-10-25');
    expect(p.nextPayday).toBe('2026-11-25');
    expect(p.daysRemaining).toBe(5); // 20,21,22,23,24
  });
  it('給料日当日は新しいサイクル（残り日数0にならない）', () => {
    const p = getPayPeriod('2026-11-25', 25);
    expect(p.start).toBe('2026-11-25');
    expect(p.nextPayday).toBe('2026-12-25');
    expect(p.daysRemaining).toBe(30);
  });
  it('給料日の前日は残り1日', () => {
    const p = getPayPeriod('2026-11-24', 25);
    expect(p.daysRemaining).toBe(1);
    expect(p.daysUntilPayday).toBe(1);
  });
  it('年をまたぐ', () => {
    const p = getPayPeriod('2026-12-30', 25);
    expect(p.start).toBe('2026-12-25');
    expect(p.nextPayday).toBe('2027-01-25');
  });
  it('31日払いは月末に丸める', () => {
    const p = getPayPeriod('2027-02-15', 31);
    expect(p.start).toBe('2027-01-31');
    expect(p.nextPayday).toBe('2027-02-28');
  });
  it('土日は前倒し', () => {
    // 2026-04-25 は土曜 → 24日（金）
    expect(paydayInMonth(2026, 4, 25, 'before')).toBe('2026-04-24');
    expect(paydayInMonth(2026, 4, 25, 'after')).toBe('2026-04-27');
  });
  it('給料日未設定は暦月', () => {
    const p = getPayPeriod('2026-11-20', null);
    expect(p.nextPayday).toBe('2026-12-01');
    expect(p.daysRemaining).toBe(11);
    const last = getPayPeriod('2026-11-30', null);
    expect(last.daysRemaining).toBe(1);
  });
});

describe('残高', () => {
  it('基準以降の記録のみ反映、未来の収入は含めない', () => {
    const txs = [
      tx({ amount: 3000 }),
      tx({ type: 'income', amount: 200000, date: '2026-11-25' }), // 未来の給料
      tx({ amount: 500, createdAt: '2026-10-31T00:00:00.000Z' }), // 基準より前の記録
      tx({ amount: 700, deleted: 1 }),
    ];
    expect(currentBalance(baseSettings, txs, '2026-11-20')).toBe(97000);
    expect(currentBalance(baseSettings, txs, '2026-11-25')).toBe(297000);
  });
});

describe('今日使える金額', () => {
  it('基本計算', () => {
    const r = computeDailyAllowance(baseSettings, [], [fc({ amount: 50000, dayOfMonth: 1 })], '2026-11-20');
    // 期間 10/25〜11/24。固定費(1日)は11/1が期間内・未払い → 差し引く
    expect(r.upcomingFixedTotal).toBe(50000);
    expect(r.perDay).toBe(Math.floor(50000 / 5));
  });
  it('支払済みの固定費は二重に差し引かない', () => {
    const f = fc({ amount: 50000, dayOfMonth: 1 });
    const paid = tx({ amount: 50000, fixedCostId: f.id, fixedCostPeriod: '2026-11', date: '2026-11-01' });
    const r = computeDailyAllowance(baseSettings, [paid], [f], '2026-11-20');
    expect(r.upcomingFixedTotal).toBe(0);
    expect(r.balance).toBe(50000);
    expect(r.perDay).toBe(10000);
  });
  it('貯金額を確保する', () => {
    const r = computeDailyAllowance({ ...baseSettings, reserveAmount: 50000 }, [], [], '2026-11-20');
    expect(r.perDay).toBe(10000);
  });
  it('今日使った分は今日の目安額を変えず、残りに反映', () => {
    const r = computeDailyAllowance(baseSettings, [tx({ amount: 3000, date: '2026-11-20' })], [], '2026-11-20');
    expect(r.perDay).toBe(20000);
    expect(r.todayRemaining).toBe(17000);
    expect(r.spentToday).toBe(3000);
  });
  it('予算残額の方が少なければ予算で制限', () => {
    const r = computeDailyAllowance({ ...baseSettings, monthlyBudget: 30000 }, [tx({ amount: 20000, date: '2026-11-01' })], [], '2026-11-20');
    expect(r.budgetRemaining).toBe(10000);
    expect(r.limitedBy).toBe('budget');
    expect(r.perDay).toBe(2000);
  });
  it('予算超過は0円、不足額を表示', () => {
    const r = computeDailyAllowance({ ...baseSettings, monthlyBudget: 10000 }, [tx({ amount: 15000, date: '2026-11-01' })], [], '2026-11-20');
    expect(r.perDay).toBe(0);
    expect(r.budgetRemaining).toBe(-5000);
    expect(r.shortfall).toBe(5000);
  });
  it('残高不足は0円、不足額を表示', () => {
    const r = computeDailyAllowance({ ...baseSettings, balanceAmount: 10000 }, [], [fc({ amount: 30000, dayOfMonth: 22 })], '2026-11-20');
    expect(r.perDay).toBe(0);
    expect(r.shortfall).toBe(20000);
  });
  it('給料日当日でもエラーにならない', () => {
    const r = computeDailyAllowance(baseSettings, [], [], '2026-11-25');
    expect(Number.isFinite(r.perDay)).toBe(true);
    expect(r.period.daysRemaining).toBe(30);
  });
  it('残高未登録なら missing に balance', () => {
    const r = computeDailyAllowance({ ...baseSettings, balanceAmount: null }, [], [], '2026-11-20');
    expect(r.missing).toContain('balance');
    expect(r.perDay).toBe(0);
  });
  it('整数のみを返す', () => {
    const r = computeDailyAllowance({ ...baseSettings, balanceAmount: 100001 }, [], [], '2026-11-22');
    expect(Number.isInteger(r.perDay)).toBe(true);
  });
  it('期間外の固定費は含めない', () => {
    const r = upcomingFixedCosts([fc({ dayOfMonth: 26, createdAt: '2026-09-01T00:00:00.000Z' })], [], getPayPeriod('2026-11-20', 25), '2026-11-20');
    // 10/25〜11/24 の間の26日 = 10/26（期限済み・未払い）
    expect(r.map((x) => x.dueDate)).toEqual(['2026-10-26']);
    expect(r[0].overdue).toBe(true);
  });
});

describe('固定費の登録日', () => {
  it('登録より前の支払日は差し引かない', () => {
    const f = fc({ dayOfMonth: 27, createdAt: '2026-11-24T03:00:00.000Z' });
    const p = getPayPeriod('2026-11-24', 25, 'before'); // 10/23〜11/25
    expect(upcomingFixedCosts([f], [], p, '2026-11-24')).toHaveLength(0);
    const p2 = getPayPeriod('2026-11-26', 25, 'before');
    expect(upcomingFixedCosts([f], [], p2, '2026-11-26').map((u) => u.dueDate)).toEqual(['2026-11-27']);
  });
});

describe('集計・CSV', () => {
  it('月別・カテゴリー別', () => {
    const s = monthlySummary(
      [tx({ amount: 100, category: 'A' }), tx({ amount: 300, category: 'B' }), tx({ amount: 50, category: 'A' }), tx({ type: 'income', amount: 1000 }), tx({ date: '2026-12-01' })],
      '2026-11',
    );
    expect(s.expense).toBe(450);
    expect(s.income).toBe(1000);
    expect(s.byCategory[0]).toEqual({ category: 'B', amount: 300 });
  });
  it('CSVはBOM付き・数式インジェクション対策', () => {
    const csv = transactionsToCsv([tx({ memo: '=HYPERLINK("x")', category: '食費' })], []);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
