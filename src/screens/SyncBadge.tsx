import { syncStatus } from '../sync/manager';
import { useStore } from '../lib/store';
import { formatDateTime } from '../lib/date';
import { href } from '../ui/router';
import { useOnline } from '../ui/hooks';

/** データの保存・同期状況（色だけに頼らず文字でも示す） */
export function useSyncLabel() {
  const s = useStore(syncStatus);
  const online = useOnline();
  if (s.state === 'local' || !s.userId) {
    return { color: 'var(--accent)', text: 'この端末にのみ保存', detail: 'クラウドバックアップは未設定です', s };
  }
  if (s.conflicts > 0) return { color: 'var(--danger)', text: `確認が必要な記録 ${s.conflicts}件`, detail: '設定 > 同期 で確認できます', s };
  if (!online) return { color: 'var(--accent)', text: `オフライン（端末に保存済み）`, detail: s.pending ? `同期待ち ${s.pending}件` : '通信が戻ると自動で同期します', s };
  if (s.state === 'syncing') return { color: 'var(--primary)', text: '同期中…', detail: s.pending ? `同期待ち ${s.pending}件` : '', s };
  if (s.state === 'error') return { color: 'var(--danger)', text: '同期できませんでした（端末には保存済み）', detail: '自動で再試行します', s };
  if (s.pending > 0) return { color: 'var(--accent)', text: `同期待ち ${s.pending}件`, detail: '端末には保存済みです', s };
  return { color: 'var(--ok)', text: 'クラウドと同期済み', detail: `最終同期 ${formatDateTime(s.lastSyncAt)}`, s };
}

export function SyncBadge() {
  const l = useSyncLabel();
  return (
    <a href={href('/settings/sync')} className="row small" style={{ color: 'var(--text-2)', textDecoration: 'none', minHeight: 44 }} aria-label={`保存状況：${l.text}。${l.detail}`}>
      <span className="status-dot" style={{ background: l.color }} aria-hidden="true" />
      <span>
        {l.text}
        {l.detail && <span className="muted"> ・ {l.detail}</span>}
      </span>
    </a>
  );
}
