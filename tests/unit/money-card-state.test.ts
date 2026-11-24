import { describe, it, expect } from 'vitest';
import { moneyCardState } from '../../src/screens/moneyCardState';

const none = { balanceAmount: null, monthlyBudget: null };

describe('お金カードの表示状態', () => {
  it('残高・予算・記録がすべてなければ未設定', () => {
    expect(moneyCardState(none, [])).toBe('unset');
  });
  it('削除済みの記録しかなければ未設定のまま', () => {
    expect(moneyCardState(none, [{ deleted: 1 }])).toBe('unset');
  });
  it('記録だけあれば recordsOnly（目安は出さない）', () => {
    expect(moneyCardState(none, [{ deleted: 0 }])).toBe('recordsOnly');
  });
  it('残高だけ登録済みなら ready', () => {
    expect(moneyCardState({ balanceAmount: 30000, monthlyBudget: null }, [])).toBe('ready');
  });
  it('予算だけ登録済みなら ready', () => {
    expect(moneyCardState({ balanceAmount: null, monthlyBudget: 20000 }, [])).toBe('ready');
  });
  it('残高0円の登録も「登録済み」として扱う', () => {
    expect(moneyCardState({ balanceAmount: 0, monthlyBudget: null }, [])).toBe('ready');
  });
});
