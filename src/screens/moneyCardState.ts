import type { AppSettings, Transaction } from '../db/types';

/**
 * ホームのお金カードの表示状態。
 * - unset:       残高も予算も未登録で、お金の記録も1件もない（初めての状態）
 * - recordsOnly: 記録はあるが、残高も予算も未登録（1日の目安は計算できない）
 * - ready:       残高または予算が登録済み（1日の目安を表示できる）
 *
 * 未設定のときに「0円」を表示しないために使う。金額の計算そのものは lib/money.ts が行う。
 */
export type MoneyCardState = 'unset' | 'recordsOnly' | 'ready';

export function moneyCardState(
  settings: Pick<AppSettings, 'balanceAmount' | 'monthlyBudget'>,
  transactions: Pick<Transaction, 'deleted'>[],
): MoneyCardState {
  const hasBalance = settings.balanceAmount !== null && settings.balanceAmount !== undefined;
  const hasBudget = settings.monthlyBudget !== null && settings.monthlyBudget !== undefined;
  if (hasBalance || hasBudget) return 'ready';
  return transactions.some((t) => !t.deleted) ? 'recordsOnly' : 'unset';
}
