import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/db';
import { getMeta, setMeta } from '../db/repo';
import { SYNC_TABLES } from '../db/types';
import { syncStatus } from '../sync/manager';
import { useStore } from '../lib/store';
import { href } from '../ui/router';
import { backupNudge, NUDGE_SNOOZE_DAYS } from './backupNudge';

/** ホームの「バックアップの声かけ」。責めない言い方で1行だけ出す */
export function BackupNudge() {
  const sync = useStore(syncStatus);
  const data = useLiveQuery(async () => {
    const db = getDb();
    let first: string | null = null;
    for (const t of SYNC_TABLES) {
      if (t === 'settings') continue;
      await db.table(t).each((r: { createdAt?: string; deleted?: number }) => {
        if (!r.deleted && r.createdAt && (first === null || r.createdAt < first)) first = r.createdAt;
      });
    }
    return {
      firstRecordAt: first as string | null,
      lastBackupAt: (await getMeta<string>('lastBackupAt', db)) ?? null,
      snoozeUntil: (await getMeta<string>('backupNudgeSnoozeUntil', db)) ?? null,
    };
  }, []);
  if (!data) return null;
  const r = backupNudge({ now: new Date(), ...data, lastCloudSyncAt: sync.userId ? sync.lastSyncAt : null });
  if (!r.show) return null;

  const snooze = () => setMeta('backupNudgeSnoozeUntil', new Date(Date.now() + NUDGE_SNOOZE_DAYS * 86_400_000).toISOString());

  return (
    <section className="banner warn backup-nudge" data-testid="backup-nudge" aria-label="バックアップのお知らせ">
      <p style={{ margin: 0 }}>
        <span aria-hidden="true">💾 </span>
        {r.kind === 'never' ? 'まだバックアップをしていません。' : `最後のバックアップから${r.days}日たちました。`}
        <br />
        <span className="small">スマホが壊れたときのために、記録を保存しておくと安心です。</span>
      </p>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <a className="btn primary small grow" href={href('/settings/backup')}>
          バックアップする
        </a>
        <button type="button" className="btn small grow" onClick={() => void snooze()}>
          あとで
        </button>
      </div>
    </section>
  );
}
