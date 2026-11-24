import { syncStatus } from '../sync/manager';
import { useStore } from '../lib/store';
import { formatDateTime } from '../lib/date';
import { href } from '../ui/router';
import { useOnline } from '../ui/hooks';
import { Icon } from '../ui/Icon';

/**
 * データの保存・同期状況。
 * 色だけに頼らず、状態ごとに「形の違うアイコン」と「文字」で伝える。
 * 詳しい説明は、タップした先（設定 > 保存と同期）で読める。
 */
export function useSyncLabel() {
  const s = useStore(syncStatus);
  const online = useOnline();
  if (s.state === 'local' || !s.userId) {
    return { color: 'var(--accent)', icon: 'phone', text: 'このスマホだけに保存しています', detail: '', s };
  }
  if (s.conflicts > 0) return { color: 'var(--danger)', icon: 'alert', text: `確認が必要な記録 ${s.conflicts}件`, detail: '設定 > 同期 で確認できます', s };
  if (!online) return { color: 'var(--accent)', icon: 'phone', text: `オフライン（端末に保存済み）`, detail: s.pending ? `同期待ち ${s.pending}件` : '通信が戻ると自動で同期します', s };
  if (s.state === 'syncing') return { color: 'var(--primary)', icon: 'sync', text: '同期中…', detail: s.pending ? `同期待ち ${s.pending}件` : '', s };
  if (s.state === 'error') return { color: 'var(--danger)', icon: 'alert', text: '同期できませんでした（端末には保存済み）', detail: '自動で再試行します', s };
  if (s.pending > 0) return { color: 'var(--accent)', icon: 'sync', text: `同期待ち ${s.pending}件`, detail: '端末には保存済みです', s };
  return { color: 'var(--ok)', icon: 'cloud-check', text: 'クラウドと同期済み', detail: `最終同期 ${formatDateTime(s.lastSyncAt)}`, s };
}

export function SyncBadge() {
  const l = useSyncLabel();
  return (
    <a
      href={href('/settings/sync')}
      className="sync-badge"
      data-testid="sync-badge"
      aria-label={`保存状況：${l.text}${l.detail ? `。${l.detail}` : ''}。くわしい説明を開く`}
    >
      <span className="sync-badge-icon" style={{ color: l.color }} aria-hidden="true">
        <Icon name={l.icon} size={22} />
      </span>
      <span className="grow">
        <span className="sync-badge-text">{l.text}</span>
        {l.detail && <span className="sync-badge-detail">{l.detail}</span>}
      </span>
      <span className="sync-badge-chev" aria-hidden="true">
        <Icon name="chev" size={20} />
      </span>
    </a>
  );
}
