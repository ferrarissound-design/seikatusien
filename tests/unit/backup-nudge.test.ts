import { describe, it, expect } from 'vitest';
import { backupNudge } from '../../src/screens/backupNudge';

const now = new Date('2027-02-01T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const base = { now, lastBackupAt: null, snoozeUntil: null, firstRecordAt: daysAgo(30), lastCloudSyncAt: null };

describe('バックアップの声かけ', () => {
  it('記録が1件もなければ出さない', () => {
    expect(backupNudge({ ...base, firstRecordAt: null })).toEqual({ show: false });
  });
  it('一度も書き出していない：最初の記録から7日未満は出さない、7日以上で出す', () => {
    expect(backupNudge({ ...base, firstRecordAt: daysAgo(6) }).show).toBe(false);
    expect(backupNudge({ ...base, firstRecordAt: daysAgo(7) })).toEqual({ show: true, kind: 'never' });
  });
  it('前回の書き出しから14日未満は出さない、14日以上で日数つきで出す', () => {
    expect(backupNudge({ ...base, lastBackupAt: daysAgo(13) }).show).toBe(false);
    expect(backupNudge({ ...base, lastBackupAt: daysAgo(14) })).toEqual({ show: true, kind: 'stale', days: 14 });
    expect(backupNudge({ ...base, lastBackupAt: daysAgo(40) })).toEqual({ show: true, kind: 'stale', days: 40 });
  });
  it('「あとで」の期限内は出さない。期限を過ぎたらまた出す', () => {
    const snoozed = new Date(now.getTime() + 86_400_000).toISOString();
    expect(backupNudge({ ...base, snoozeUntil: snoozed }).show).toBe(false);
    expect(backupNudge({ ...base, snoozeUntil: daysAgo(1) }).show).toBe(true);
  });
  it('クラウドと最近同期できていれば出さない。長く同期できていなければ出す', () => {
    expect(backupNudge({ ...base, lastCloudSyncAt: daysAgo(1) }).show).toBe(false);
    expect(backupNudge({ ...base, lastCloudSyncAt: daysAgo(20) }).show).toBe(true);
  });
  it('壊れた日時の値でもエラーにならない', () => {
    expect(() => backupNudge({ ...base, lastBackupAt: 'xxx', snoozeUntil: 'yyy', lastCloudSyncAt: 'zzz' })).not.toThrow();
  });
});
