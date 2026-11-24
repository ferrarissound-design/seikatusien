/**
 * バックアップの声かけを出すかどうかの判定（純粋関数）。
 * - 前回の書き出しから 14 日以上たったら出す
 * - 一度も書き出していなければ、最初の記録から 7 日たったら出す（始めたばかりの人を急かさない）
 * - クラウドと最近同期できている人、記録が1件もない人、「あとで」を押して7日以内の人には出さない
 */
export const NUDGE_AFTER_BACKUP_DAYS = 14;
export const NUDGE_AFTER_FIRST_RECORD_DAYS = 7;
export const NUDGE_SNOOZE_DAYS = 7;
const DAY = 86_400_000;

export interface NudgeInput {
  now: Date;
  /** 最後に書き出した日時（ISO）。一度もなければ null */
  lastBackupAt: string | null;
  /** 「あとで」で非表示にしている期限（ISO） */
  snoozeUntil: string | null;
  /** いちばん古い記録の作成日時（ISO）。記録がなければ null */
  firstRecordAt: string | null;
  /** 最後にクラウドと同期できた日時（ログインしていなければ null） */
  lastCloudSyncAt: string | null;
}

export type NudgeResult = { show: false } | { show: true; kind: 'never' } | { show: true; kind: 'stale'; days: number };

const ms = (iso: string | null) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export function backupNudge(i: NudgeInput): NudgeResult {
  const now = i.now.getTime();
  const first = ms(i.firstRecordAt);
  if (first === null) return { show: false };
  const synced = ms(i.lastCloudSyncAt);
  if (synced !== null && now - synced < NUDGE_AFTER_BACKUP_DAYS * DAY) return { show: false };
  const snooze = ms(i.snoozeUntil);
  if (snooze !== null && now < snooze) return { show: false };
  const last = ms(i.lastBackupAt);
  if (last === null) {
    return now - first >= NUDGE_AFTER_FIRST_RECORD_DAYS * DAY ? { show: true, kind: 'never' } : { show: false };
  }
  const days = Math.floor((now - last) / DAY);
  return days >= NUDGE_AFTER_BACKUP_DAYS ? { show: true, kind: 'stale', days } : { show: false };
}
