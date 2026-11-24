import type { WeightEntry } from '../db/types';
import { addDays, type DateStr } from './date';

/**
 * 体重の入力・表示。0.01kg 単位の整数（weightCg）で扱い、小数の誤差を出さない。
 * 判定（BMI・目標・良し悪し）は行わない。
 */

export const MIN_WEIGHT_CG = 100; // 1.00kg
export const MAX_WEIGHT_CG = 50000; // 500.00kg

/** "65.4" "６５．４５" "65.45kg" などを 0.01kg 単位の整数に。不正なら null（小数第2位まで） */
export function parseKg(input: string): number | null {
  const s = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/\s|kg|ｋｇ|キロ/gi, '');
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cg = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cg) || cg < MIN_WEIGHT_CG || cg > MAX_WEIGHT_CG) return null;
  return cg;
}

/** 6545 → "65.45"、6540 → "65.4"、6500 → "65.0"（単位なし） */
export function kgText(cg: number): string {
  const whole = Math.trunc(cg / 100);
  const frac = String(Math.abs(cg % 100)).padStart(2, '0').replace(/0$/, '');
  return `${whole}.${frac || '0'}`;
}

export const formatKg = (cg: number) => `${kgText(cg)}kg`;

/** 増減を文字と矢印で表す（色は使わない。良し悪しを示さない） */
export function formatDiff(diffCg: number): string {
  if (diffCg === 0) return '→ 変わらず';
  return `${diffCg > 0 ? '↑' : '↓'} ${kgText(Math.abs(diffCg))}kg`;
}

/** 新しい順（同じ日は時刻→作成日時の新しい順） */
export function sortNewestFirst(list: WeightEntry[]): WeightEntry[] {
  return list
    .filter((w) => !w.deleted)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.time ?? '').localeCompare(a.time ?? '') ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

export interface DailyPoint {
  date: DateStr;
  /** その日の最後の記録 */
  weightCg: number;
}

/** 期間内（今日を含む days 日）の、1日1点（その日の最後の記録）の推移。古い順 */
export function dailySeries(list: WeightEntry[], todayStr: DateStr, days: number): DailyPoint[] {
  const from = addDays(todayStr, -(days - 1));
  const byDate = new Map<string, DailyPoint>();
  for (const w of sortNewestFirst(list)) {
    if (w.date < from || w.date > todayStr) continue;
    if (!byDate.has(w.date)) byDate.set(w.date, { date: w.date, weightCg: w.weightCg });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function weightsToCsv(list: WeightEntry[]): string {
  const esc = (v: string) => {
    let s = v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [...sortNewestFirst(list)].reverse().map((w) => [w.date, w.time ?? '', kgText(w.weightCg), esc(w.memo), w.id].join(','));
  return '﻿' + [['日付', '時刻', '体重(kg)', 'メモ', 'ID'].join(','), ...rows].join('\r\n') + '\r\n';
}
