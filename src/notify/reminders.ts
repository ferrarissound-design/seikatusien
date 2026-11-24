import type { Reminder, Task, FixedCost, AppSettings, ReminderKind } from '../db/types';
import { today, toDateStr, timeToMinutes, weekday, addDays, type DateStr } from '../lib/date';
import { getPayPeriod, fixedCostDueDates } from '../lib/money';

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  checklist: '忘れ物チェック',
  taskDue: 'タスクの期限',
  recurringTask: '繰り返しタスク',
  payment: '支払い予定',
  payday: '給料日',
  expenseLog: '支出の記録',
};

export interface DueNotice {
  key: string;
  title: string;
  body: string;
}

/**
 * 指定期間 (since, now] の間に時刻を迎えたリマインダーを返す。
 * アプリを開いていない間に過ぎたものも、次に開いたときにアプリ内通知として表示する（当日分のみ）。
 */
export function dueReminders(
  reminders: Reminder[],
  ctx: { tasks: Task[]; fixedCosts: FixedCost[]; settings: AppSettings },
  since: Date,
  now: Date,
): DueNotice[] {
  const out: DueNotice[] = [];
  const d = toDateStr(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sinceSameDay = toDateStr(since) === d;
  const sinceMin = sinceSameDay ? since.getHours() * 60 + since.getMinutes() : -1;

  for (const r of reminders) {
    if (r.deleted || !r.enabled) continue;
    if (r.weekdays.length && !r.weekdays.includes(weekday(d))) continue;
    const m = timeToMinutes(r.time);
    if (!(m > sinceMin && m <= nowMin)) continue;
    const n = describeReminder(r, ctx, d);
    if (n) out.push({ key: `${r.id}:${d}`, ...n });
  }
  return out;
}

export function describeReminder(
  r: Reminder,
  ctx: { tasks: Task[]; fixedCosts: FixedCost[]; settings: AppSettings },
  d: DateStr = today(),
): { title: string; body: string } | null {
  switch (r.kind) {
    case 'checklist':
      return { title: '忘れ物チェック', body: r.label || '出かける前に持ち物を確認しましょう' };
    case 'expenseLog':
      return { title: '支出の記録', body: r.label || '今日使ったお金をメモしておきましょう' };
    case 'taskDue': {
      const due = ctx.tasks.filter((t) => !t.deleted && !t.done && t.dueDate === d);
      if (!due.length) return null;
      return { title: '今日のタスク', body: `${due.slice(0, 3).map((t) => t.title).join('、')}${due.length > 3 ? ` ほか${due.length - 3}件` : ''}` };
    }
    case 'recurringTask': {
      const due = ctx.tasks.filter((t) => !t.deleted && !t.done && t.dueDate === d && t.recurrence.kind !== 'none');
      if (!due.length) return null;
      return { title: 'いつものタスク', body: due.map((t) => t.title).slice(0, 3).join('、') };
    }
    case 'payment': {
      const tomorrow = addDays(d, 1);
      const due = ctx.fixedCosts.filter(
        (f) => !f.deleted && f.active && (fixedCostDueDates(f, d, addDays(tomorrow, 1)).length > 0),
      );
      if (!due.length) return null;
      return { title: '支払い予定', body: `${due.map((f) => f.name).join('、')} の支払日が近づいています` };
    }
    case 'payday': {
      if (!ctx.settings.paydayDay) return null;
      const p = getPayPeriod(d, ctx.settings.paydayDay, ctx.settings.paydayWeekendRule);
      if (p.start === d) return { title: '給料日', body: '今日は給料日です。入金を確認したら残高を更新しましょう' };
      if (p.daysUntilPayday === 1) return { title: '明日は給料日', body: '給料日の前日です' };
      return null;
    }
  }
}

export function isPastToday(time: string, now: Date = new Date()): boolean {
  return now.getHours() * 60 + now.getMinutes() >= timeToMinutes(time);
}
