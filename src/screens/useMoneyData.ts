import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/db';
import { computeDailyAllowance } from '../lib/money';
import { useSettings, useToday } from '../ui/hooks';

export function useMoneyData() {
  const settings = useSettings();
  const todayStr = useToday();
  const transactions = useLiveQuery(() => getDb().transactions.toArray(), []);
  const fixedCosts = useLiveQuery(() => getDb().fixedCosts.toArray(), []);
  if (!settings || !transactions || !fixedCosts) return null;
  const allowance = computeDailyAllowance(settings, transactions, fixedCosts, todayStr);
  return { settings, transactions, fixedCosts, allowance, todayStr };
}

export const CATEGORY_EMOJI: Record<string, string> = {
  食費: '🍚',
  コンビニ: '🏪',
  交通費: '🚃',
  趣味: '🎮',
  日用品: '🧴',
  その他: '📦',
  住居: '🏠',
  通信: '📱',
  光熱費: '💡',
  医療: '🏥',
  固定費: '📅',
  給料: '💴',
};
export const catEmoji = (c: string) => CATEGORY_EMOJI[c] ?? '🏷️';
