/**
 * 日付ユーティリティ。
 * アプリ内の「日付」は端末のローカル時刻に基づく "YYYY-MM-DD" 文字列で扱う。
 * タイムゾーンずれによる日付の取り違えを避けるため、Date の UTC 系メソッドは
 * 日数差の計算（正午基準）にのみ使用する。
 */

export type DateStr = string; // "YYYY-MM-DD"

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(now: Date = new Date()): DateStr {
  return toDateStr(now);
}

export function parseDateStr(s: DateStr): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** ローカル日付の正午を表す Date（DST等の影響を受けにくい） */
export function fromDateStr(s: DateStr): Date {
  const { y, m, d } = parseDateStr(s);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function isValidDateStr(s: unknown): s is DateStr {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseDateStr(s);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  // m: 1-12
  return new Date(y, m, 0).getDate();
}

/** b - a の日数（a,b とも YYYY-MM-DD） */
export function diffDays(a: DateStr, b: DateStr): number {
  const pa = parseDateStr(a);
  const pb = parseDateStr(b);
  const ua = Date.UTC(pa.y, pa.m - 1, pa.d);
  const ub = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((ub - ua) / 86400000);
}

export function addDays(s: DateStr, n: number): DateStr {
  const { y, m, d } = parseDateStr(s);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 月を加算。日は月末に丸める（1/31 + 1ヶ月 = 2/28 or 29） */
export function addMonths(s: DateStr, n: number): DateStr {
  const { y, m, d } = parseDateStr(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/** 指定年月の day 日（月末を超える場合は月末に丸め） */
export function dateInMonth(y: number, m: number, day: number): DateStr {
  return `${y}-${pad(m)}-${pad(Math.min(Math.max(1, day), daysInMonth(y, m)))}`;
}

export function monthKey(s: DateStr): string {
  return s.slice(0, 7);
}

/** 0=日 ... 6=土 */
export function weekday(s: DateStr): number {
  const { y, m, d } = parseDateStr(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

export function formatJa(s: DateStr, withWeekday = true): string {
  const { y, m, d } = parseDateStr(s);
  return `${y}年${m}月${d}日${withWeekday ? `（${WEEKDAY_JA[weekday(s)]}）` : ''}`;
}

export function formatShort(s: DateStr): string {
  const { m, d } = parseDateStr(s);
  return `${m}/${d}（${WEEKDAY_JA[weekday(s)]}）`;
}

/** "HH:MM" を分に */
export function timeToMinutes(t: string): number {
  const [h, mi] = t.split(':').map(Number);
  return h * 60 + mi;
}

export function isValidTime(t: unknown): t is string {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/**
 * 「論理的な日付」。リセット時刻（例 04:00）より前は前日扱いにする。
 * 深夜0時を過ぎても、朝のリセット時刻までは前日の続きとして扱える。
 */
export function logicalDate(now: Date, resetTime: string | null | undefined): DateStr {
  if (!resetTime || !isValidTime(resetTime)) return toDateStr(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < timeToMinutes(resetTime)) {
    return addDays(toDateStr(now), -1);
  }
  return toDateStr(now);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
