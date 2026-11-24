import { describe, it, expect, beforeEach } from 'vitest';
import { parseKg, kgText, formatDiff, dailySeries, weightsToCsv, sortNewestFirst } from '../../src/lib/weight';
import { adoptDb, LifePartnerDB, setActiveDb } from '../../src/db/db';
import { addWeight } from '../../src/db/actions';
import { SyncEngine } from '../../src/sync/engine';
import { buildBackup, planImport } from '../../src/backup/backup';
import type { WeightEntry } from '../../src/db/types';
import { FakeServer } from './fakeServer';

// すべて架空のデータ
let n = 0;
function w(p: Partial<WeightEntry>): WeightEntry {
  n++;
  return { id: `w${n}`, createdAt: `2026-11-0${(n % 9) + 1}T00:00:00.000Z`, updatedAt: '2026-11-01T00:00:00.000Z', serverVersion: 0, deleted: 0, date: '2026-11-20', time: '07:00', weightCg: 6000, memo: '', ...p };
}

describe('体重の入力', () => {
  it('小数第2位まで受け付け、0.01kg 単位の整数にする', () => {
    expect(parseKg('65.45')).toBe(6545);
    expect(parseKg('65.4')).toBe(6540);
    expect(parseKg('65')).toBe(6500);
    expect(parseKg('６５．４５')).toBe(6545);
    expect(parseKg('65.45kg')).toBe(6545);
    expect(parseKg(' 65.45 キロ')).toBe(6545);
  });
  it('小数第3位以降・範囲外・不正な文字は受け付けない', () => {
    expect(parseKg('65.456')).toBeNull();
    expect(parseKg('0.5')).toBeNull();
    expect(parseKg('600')).toBeNull();
    expect(parseKg('-60')).toBeNull();
    expect(parseKg('abc')).toBeNull();
    expect(parseKg('')).toBeNull();
    expect(parseKg('65,4')).toBeNull();
  });
  it('表示（浮動小数点の誤差なし）', () => {
    expect(kgText(6545)).toBe('65.45');
    expect(kgText(6540)).toBe('65.4');
    expect(kgText(6500)).toBe('65.0');
    expect(kgText(6505)).toBe('65.05');
    expect(kgText(10001)).toBe('100.01');
  });
  it('増減は矢印と文字で表す', () => {
    expect(formatDiff(30)).toBe('↑ 0.3kg');
    expect(formatDiff(-125)).toBe('↓ 1.25kg');
    expect(formatDiff(0)).toBe('→ 変わらず');
  });
});

describe('推移', () => {
  it('1日1点（その日の最後の記録）で、期間内だけ古い順に並べる', () => {
    const list = [
      w({ date: '2026-11-20', time: '07:00', weightCg: 6000 }),
      w({ date: '2026-11-20', time: '21:00', weightCg: 6050 }),
      w({ date: '2026-11-19', weightCg: 5990 }),
      w({ date: '2026-10-01', weightCg: 6200 }), // 期間外
      w({ date: '2026-11-18', weightCg: 7000, deleted: 1 }), // 削除済み
    ];
    expect(dailySeries(list, '2026-11-20', 30)).toEqual([
      { date: '2026-11-19', weightCg: 5990 },
      { date: '2026-11-20', weightCg: 6050 },
    ]);
  });
  it('新しい順の並び', () => {
    const list = [w({ date: '2026-11-19' }), w({ date: '2026-11-20', time: '06:00' }), w({ date: '2026-11-20', time: '22:00' })];
    expect(sortNewestFirst(list).map((x) => `${x.date} ${x.time}`)).toEqual(['2026-11-20 22:00', '2026-11-20 06:00', '2026-11-19 07:00']);
  });
  it('CSV は BOM 付き・数式インジェクション対策', () => {
    const csv = weightsToCsv([w({ weightCg: 6545, memo: '=1+1' })]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('65.45');
    expect(csv).toContain("'=1+1");
  });
});

describe('体重の保存・同期・バックアップ', () => {
  let seq = 0;
  beforeEach(() => {
    seq++;
  });
  it('不正な値は保存しない', async () => {
    setActiveDb(`lifepartner-u-weight-bad-${seq}`);
    await expect(addWeight({ weightCg: 65.4 })).rejects.toThrow();
    await expect(addWeight({ weightCg: 50 })).rejects.toThrow();
  });
  it('記録 → 同期 → 別端末で復元できる', async () => {
    const server = new FakeServer();
    const a = adoptDb(new LifePartnerDB(`lifepartner-u-weight-a-${seq}`));
    const rec = await addWeight({ weightCg: 6545, memo: '朝' });
    await new SyncEngine(a, server.transport('u')).sync();
    const b = adoptDb(new LifePartnerDB(`lifepartner-u-weight-b-${seq}`));
    await new SyncEngine(b, server.transport('u')).sync();
    const got = await b.weights.get(rec.id);
    expect(got?.weightCg).toBe(6545);
    expect(got?.memo).toBe('朝');
  });
  it('バックアップに含まれ、復元時に検証される', async () => {
    const a = adoptDb(new LifePartnerDB(`lifepartner-u-weight-c-${seq}`));
    await addWeight({ weightCg: 7012 });
    const file = await buildBackup(a);
    expect(file.tables.weights).toHaveLength(1);
    const b = adoptDb(new LifePartnerDB(`lifepartner-u-weight-d-${seq}`));
    const ok = await planImport(b, JSON.stringify(file));
    expect(ok.counts.weights).toBe(1);
    const bad = { ...file, tables: { weights: [{ ...file.tables.weights![0], weightCg: 99999999 }] } };
    const plan = await planImport(b, JSON.stringify(bad));
    expect(plan.invalid).toHaveLength(1);
  });
});
