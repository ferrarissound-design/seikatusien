import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/db';
import { PageHead, Card, Sheet, Toggle, Empty } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { href } from '../../ui/router';
import { createRecord, updateRecord } from '../../db/repo';
import { deleteWithUndo } from '../../db/actions';
import type { Reminder, ReminderKind } from '../../db/types';
import { REMINDER_KIND_LABELS } from '../../notify/reminders';
import { notificationPermission, requestNotificationPermission, subscribeWebPush, isWebPushConfigured, type PermissionState } from '../../notify/notifier';
import { WEEKDAY_JA, isValidTime } from '../../lib/date';
import { useStore } from '../../lib/store';
import { syncStatus } from '../../sync/manager';

const DEFAULT_TIMES: Record<ReminderKind, string> = {
  checklist: '07:30',
  taskDue: '08:00',
  recurringTask: '08:00',
  payment: '09:00',
  payday: '09:00',
  expenseLog: '21:00',
};

export function ReminderSettings() {
  const reminders = useLiveQuery(async () => (await getDb().reminders.toArray()).filter((r) => !r.deleted).sort((a, b) => a.time.localeCompare(b.time)), []);
  const [perm, setPerm] = useState<PermissionState>(notificationPermission());
  const [editing, setEditing] = useState<Reminder | ReminderKind | null>(null);
  const [pushMsg, setPushMsg] = useState('');
  const sync = useStore(syncStatus);
  if (!reminders) return null;

  return (
    <main>
      <PageHead title="通知・リマインダー" back="/settings" />
      <Card title="通知の受け取り方" icon="🔔">
        <p className="small">
          設定した時刻を過ぎると、<strong>アプリを開いたときに「お知らせ」として表示</strong>します（これは必ず動きます）。
        </p>
        {perm === 'needs-install' && (
          <p className="banner warn small">
            iPhone で端末の通知を受け取るには、先に <a href={href('/settings/install')}>ホーム画面に追加</a> して、ホーム画面から開いてください（iOS 16.4 以降）。
          </p>
        )}
        {perm === 'unsupported' && <p className="banner warn small">この環境は端末の通知に対応していません。アプリ内のお知らせで代わりに表示します。</p>}
        {perm === 'default' && (
          <button
            type="button"
            className="btn primary block"
            onClick={async () => {
              setPerm(await requestNotificationPermission());
            }}
          >
            <Icon name="bell" /> 端末の通知を許可する
          </button>
        )}
        {perm === 'denied' && <p className="banner warn small">通知がオフになっています。iPhone の「設定」→「通知」→「Life Partner」からオンにできます。</p>}
        {perm === 'granted' && (
          <>
            <p className="banner info small">端末の通知は許可されています。アプリを開いている間は、時刻になると端末に通知します。</p>
            {isWebPushConfigured && sync.userId ? (
              <>
                <button
                  type="button"
                  className="btn block"
                  onClick={async () => {
                    const r = await subscribeWebPush();
                    setPushMsg(
                      r === 'ok'
                        ? 'アプリを閉じている間の通知を登録しました（届くかどうかは IPHONE_TEST.md の手順で確認してください）。'
                        : r === 'not-logged-in'
                          ? 'ログインが必要です。'
                          : '登録できませんでした。',
                    );
                  }}
                >
                  アプリを閉じていても通知を受け取る（試験的）
                </button>
                {pushMsg && <p className="small muted" style={{ marginTop: 8 }}>{pushMsg}</p>}
              </>
            ) : (
              <p className="small muted" style={{ marginBottom: 0 }}>
                アプリを閉じている間の通知（Web Push）は、クラウド同期とサーバー側の通知設定が必要です。現在は未設定のため、アプリを開いたときにお知らせします。
              </p>
            )}
          </>
        )}
      </Card>

      <Card title="リマインダー">
        {reminders.length === 0 ? (
          <Empty emoji="⏰">まだリマインダーはありません。下から追加できます。</Empty>
        ) : (
          <ul className="list">
            {reminders.map((r) => (
              <li key={r.id} className="row" style={{ minHeight: 64 }}>
                <button type="button" className="check-row grow" onClick={() => setEditing(r)}>
                  <span className="label-text">
                    <strong className="num">{r.time}</strong> {REMINDER_KIND_LABELS[r.kind]}
                    <span className="muted small" style={{ display: 'block' }}>
                      {r.weekdays.length ? [...r.weekdays].sort((a, b) => a - b).map((w) => WEEKDAY_JA[w]).join('・') : '毎日'}
                      {r.label && ` ・ ${r.label}`}
                    </span>
                  </span>
                </button>
                <span className="switch">
                  <input type="checkbox" role="switch" aria-label={`${REMINDER_KIND_LABELS[r.kind]} ${r.time} を有効にする`} checked={!!r.enabled} onChange={(e) => void updateRecord<Reminder>('reminders', r.id, { enabled: e.target.checked ? 1 : 0 })} />
                  <span className="track" aria-hidden="true" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="追加する">
        <div className="cat-grid">
          {(Object.keys(REMINDER_KIND_LABELS) as ReminderKind[]).map((k) => (
            <button key={k} type="button" className="cat-btn" onClick={() => setEditing(k)}>
              {REMINDER_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </Card>
      {editing && <ReminderSheet value={editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

function ReminderSheet({ value, onClose }: { value: Reminder | ReminderKind; onClose: () => void }) {
  const existing = typeof value === 'string' ? null : value;
  const kind = existing ? existing.kind : (value as ReminderKind);
  const [time, setTime] = useState(existing?.time ?? DEFAULT_TIMES[kind]);
  const [days, setDays] = useState<number[]>(existing?.weekdays ?? []);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [enabled, setEnabled] = useState(existing ? !!existing.enabled : true);
  const save = async () => {
    if (!isValidTime(time)) return;
    const data = { kind, time, weekdays: days, label: label.slice(0, 200), enabled: (enabled ? 1 : 0) as 0 | 1, targetId: null };
    if (existing) await updateRecord<Reminder>('reminders', existing.id, data);
    else await createRecord<Reminder>('reminders', data);
    onClose();
  };
  return (
    <Sheet
      title={REMINDER_KIND_LABELS[kind]}
      onClose={onClose}
      actions={
        <>
          {existing && (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                void deleteWithUndo('reminders', existing.id, 'リマインダー');
                onClose();
              }}
            >
              削除
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => void save()} disabled={!isValidTime(time)}>
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span>時刻</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <div className="field">
        <span className="muted small" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
          曜日（選ばなければ毎日）
        </span>
        <div className="row wrap" role="group" aria-label="曜日">
          {WEEKDAY_JA.map((w, i) => (
            <button key={w} type="button" className="chip" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i])}>
              {w}
            </button>
          ))}
        </div>
      </div>
      {(kind === 'checklist' || kind === 'expenseLog') && (
        <label className="field">
          <span>メッセージ（任意）</span>
          <input type="text" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} placeholder={kind === 'checklist' ? '例：出かける前に持ち物チェック' : '例：今日の支出をメモしよう'} />
        </label>
      )}
      {(kind === 'taskDue' || kind === 'recurringTask' || kind === 'payment' || kind === 'payday') && (
        <p className="muted small">対象があるときだけ通知します（例：その日が期限のタスクがあるとき）。</p>
      )}
      <Toggle label="有効にする" checked={enabled} onChange={setEnabled} />
    </Sheet>
  );
}
