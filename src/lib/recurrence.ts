import { addDays, dateInMonth, parseDateStr, addMonths, weekday, WEEKDAY_JA, type DateStr } from './date';
import type { Recurrence } from '../db/types';

/** 基準日の「次の」発生日（基準日自体は含まない） */
export function nextOccurrence(r: Recurrence, after: DateStr): DateStr | null {
  switch (r.kind) {
    case 'none':
      return null;
    case 'daily':
      return addDays(after, 1);
    case 'weekly': {
      const days = r.weekdays.length ? r.weekdays : [weekday(after)];
      for (let i = 1; i <= 7; i++) {
        const d = addDays(after, i);
        if (days.includes(weekday(d))) return d;
      }
      return addDays(after, 7);
    }
    case 'monthly': {
      const { y, m } = parseDateStr(after);
      const thisMonth = dateInMonth(y, m, r.day);
      if (thisMonth > after) return thisMonth;
      const nm = parseDateStr(addMonths(dateInMonth(y, m, 1), 1));
      return dateInMonth(nm.y, nm.m, r.day);
    }
  }
}

export function describeRecurrence(r: Recurrence): string {
  switch (r.kind) {
    case 'none':
      return '';
    case 'daily':
      return '毎日';
    case 'weekly':
      return r.weekdays.length === 0
        ? '毎週'
        : `毎週 ${[...r.weekdays].sort((a, b) => a - b).map((w) => WEEKDAY_JA[w]).join('・')}`;
    case 'monthly':
      return `毎月${r.day}日`;
  }
}

export function isValidRecurrence(r: unknown): r is Recurrence {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  switch (o.kind) {
    case 'none':
    case 'daily':
      return true;
    case 'weekly':
      return Array.isArray(o.weekdays) && o.weekdays.every((w) => Number.isInteger(w) && (w as number) >= 0 && (w as number) <= 6);
    case 'monthly':
      return Number.isInteger(o.day) && (o.day as number) >= 1 && (o.day as number) <= 31;
    default:
      return false;
  }
}
