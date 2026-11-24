import { describe, it, expect } from 'vitest';
import { addDays, addMonths, diffDays, logicalDate, isValidDateStr, dateInMonth } from '../../src/lib/date';

describe('date utils', () => {
  it('年・月をまたぐ加算', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2027-01-15', -1)).toBe('2026-12-15');
  });
  it('日数差', () => {
    expect(diffDays('2026-12-25', '2027-01-25')).toBe(31);
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
  });
  it('リセット時刻前は前日扱い', () => {
    expect(logicalDate(new Date(2026, 0, 1, 3, 59), '04:00')).toBe('2025-12-31');
    expect(logicalDate(new Date(2026, 0, 1, 4, 0), '04:00')).toBe('2026-01-01');
    expect(logicalDate(new Date(2026, 0, 1, 0, 30), null)).toBe('2026-01-01');
  });
  it('日付検証', () => {
    expect(isValidDateStr('2026-02-29')).toBe(false);
    expect(isValidDateStr('2028-02-29')).toBe(true);
    expect(isValidDateStr('2026-13-01')).toBe(false);
    expect(isValidDateStr('abc')).toBe(false);
  });
  it('月末丸め', () => {
    expect(dateInMonth(2026, 2, 31)).toBe('2026-02-28');
    expect(dateInMonth(2026, 4, 31)).toBe('2026-04-30');
  });
});
