import { useEffect, useState } from 'react';
import { PageHead, Card, Toggle, Segmented, Confirm, Sheet } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { href, useRoute } from '../../ui/router';
import { useSettings } from '../../ui/hooks';
import { saveSettings, DEFAULT_EXPENSE_CATEGORIES } from '../../db/repo';
import { SyncSettings } from './SyncSettings';
import { BackupSettings } from './BackupSettings';
import { ReminderSettings } from './ReminderSettings';
import { InstallGuide, PrivacyPage, ManualPage } from './Guides';
import { MoneySetup } from '../Money';
import { getDb, LOCAL_DB_NAME } from '../../db/db';
import { syncStatus } from '../../sync/manager';
import { useStore } from '../../lib/store';
import { toast } from '../../lib/events';
import { clearAppCache, getStorageInfo, type StorageInfo } from '../../pwa';
import { SyncBadge } from '../SyncBadge';

export function SettingsScreen() {
  const route = useRoute();
  switch (route.path[1]) {
    case 'sync':
      return <SyncSettings />;
    case 'backup':
      return <BackupSettings />;
    case 'reminders':
      return <ReminderSettings />;
    case 'display':
      return <DisplaySettings />;
    case 'features':
      return <FeatureSettings />;
    case 'categories':
      return <CategorySettings />;
    case 'install':
      return <InstallGuide />;
    case 'privacy':
      return <PrivacyPage />;
    case 'manual':
      return <ManualPage />;
    case 'data':
      return <DataSettings />;
    case 'money':
      return (
        <main>
          <PageHead title="お金の設定" back="/settings" />
          <MoneySetup embedded onDone={() => history.back()} />
        </main>
      );
    default:
      return <SettingsMenu />;
  }
}

function MenuLink({ to, icon, label, sub }: { to: string; icon: string; label: string; sub?: string }) {
  return (
    <a href={href(to)}>
      <span aria-hidden="true" style={{ fontSize: '1.3rem', width: 28, textAlign: 'center' }}>
        {icon}
      </span>
      <span className="grow">
        {label}
        {sub && <span className="muted small" style={{ display: 'block' }}>{sub}</span>}
      </span>
      <span className="chev">
        <Icon name="chev" />
      </span>
    </a>
  );
}

function SettingsMenu() {
  return (
    <main>
      <PageHead title="設定" />
      <SyncBadge />
      <Card title="データを守る">
        <nav className="menu-list">
          <MenuLink to="/settings/sync" icon="☁️" label="保存と同期" sub="クラウドバックアップ・ログイン" />
          <MenuLink to="/settings/backup" icon="💾" label="バックアップ" sub="ファイルへの書き出し・復元" />
        </nav>
      </Card>
      <Card title="使い方の調整">
        <nav className="menu-list">
          <MenuLink to="/settings/features" icon="🧩" label="使う機能" sub="使わない機能は隠せます" />
          <MenuLink to="/settings/reminders" icon="🔔" label="通知・リマインダー" />
          <MenuLink to="/settings/money" icon="👛" label="給料日・予算・残高" />
          <MenuLink to="/settings/categories" icon="🏷️" label="カテゴリー" />
          <MenuLink to="/settings/display" icon="🎨" label="表示" sub="文字の大きさ・ダークモード・動き" />
        </nav>
      </Card>
      <Card title="ヘルプ">
        <nav className="menu-list">
          <MenuLink to="/settings/manual" icon="📖" label="かんたん使い方ガイド" />
          <MenuLink to="/settings/install" icon="📲" label="ホーム画面に追加する方法" />
          <MenuLink to="/settings/privacy" icon="🔒" label="プライバシーについて" />
          <MenuLink to="/settings/data" icon="🗑️" label="データの削除・アプリの更新" />
        </nav>
      </Card>
      <p className="muted small center" style={{ marginTop: 16 }}>
        Life Partner v{__APP_VERSION__}
        <br />
        医療・診断を目的としたアプリではなく、日常生活を補助するツールです。
      </p>
    </main>
  );
}

function DisplaySettings() {
  const s = useSettings();
  if (!s) return null;
  return (
    <main>
      <PageHead title="表示" back="/settings" />
      <Card title="画面の色">
        <Segmented
          label="画面の色"
          value={s.theme}
          onChange={(v) => void saveSettings({ theme: v })}
          options={[
            { value: 'system', label: '端末に合わせる' },
            { value: 'light', label: 'ライト' },
            { value: 'dark', label: 'ダーク' },
          ]}
        />
      </Card>
      <Card title="文字の大きさ">
        <Segmented
          label="文字の大きさ"
          value={s.fontScale}
          onChange={(v) => void saveSettings({ fontScale: v })}
          options={[
            { value: 1, label: 'ふつう' },
            { value: 1.15, label: '大きい' },
            { value: 1.3, label: 'とても大きい' },
          ]}
        />
        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          画面はピンチ操作で拡大することもできます。
        </p>
      </Card>
      <Card title="動き（アニメーション）">
        <Segmented
          label="アニメーション"
          value={s.reduceMotion}
          onChange={(v) => void saveSettings({ reduceMotion: v })}
          options={[
            { value: 'system', label: '端末に合わせる' },
            { value: 'off', label: '動きを止める' },
            { value: 'on', label: '動きあり' },
          ]}
        />
      </Card>
    </main>
  );
}

function FeatureSettings() {
  const s = useSettings();
  if (!s) return null;
  const set = (k: keyof typeof s.features, v: boolean) => void saveSettings({ features: { ...s.features, [k]: v } });
  return (
    <main>
      <PageHead title="使う機能" back="/settings" />
      <Card>
        <p className="small muted">使わない機能をオフにすると、ホームや下のメニューから隠れます。データは消えません。</p>
        <Toggle label="🎒 忘れ物チェック" checked={s.features.checklists} onChange={(v) => set('checklists', v)} />
        <Toggle label="✏️ タスク" checked={s.features.tasks} onChange={(v) => set('tasks', v)} />
        <Toggle label="👛 お金" checked={s.features.money} onChange={(v) => set('money', v)} />
      </Card>
      <Card>
        <Toggle
          label="未完了のタスクを自動で繰り越す"
          description="期限を過ぎたタスクを、次の日の「今日やること」に移します"
          checked={s.taskRollover}
          onChange={(v) => void saveSettings({ taskRollover: v })}
        />
      </Card>
    </main>
  );
}

function CategoryEditor({ title, list, onChange }: { title: string; list: string[]; onChange: (l: string[]) => void }) {
  const [v, setV] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  return (
    <Card title={title}>
      <ul className="list">
        {list.map((c, i) => (
          <li key={c + i} className="row">
            <span className="grow" style={{ minHeight: 48, display: 'flex', alignItems: 'center' }}>
              {c}
            </span>
            <button type="button" className="icon-btn" aria-label={`${c}を上へ`} disabled={i === 0} onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>
              <Icon name="up" size={20} />
            </button>
            <button type="button" className="icon-btn" aria-label={`${c}の名前を変える`} onClick={() => { setEditing(i); setEditText(c); }}>
              <Icon name="edit" size={20} />
            </button>
            <button type="button" className="icon-btn" aria-label={`${c}を削除`} disabled={list.length <= 1} onClick={() => onChange(list.filter((_, k) => k !== i))}>
              <Icon name="trash" size={20} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        style={{ marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          const t = v.trim().slice(0, 30);
          if (t && !list.includes(t) && list.length < 30) onChange([...list, t]);
          setV('');
        }}
      >
        <input type="text" value={v} onChange={(e) => setV(e.target.value)} placeholder="カテゴリーを追加" aria-label="カテゴリーを追加" maxLength={30} />
        <button type="submit" className="btn primary" aria-label="追加" style={{ flex: 'none' }}>
          <Icon name="plus" />
        </button>
      </form>
      <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
        削除しても、そのカテゴリーで記録したデータは消えません。
      </p>
      {editing !== null && (
        <Sheet
          title="名前を変える"
          onClose={() => setEditing(null)}
          actions={
            <button
              type="button"
              className="btn primary"
              disabled={!editText.trim()}
              onClick={() => {
                const n = [...list];
                n[editing] = editText.trim().slice(0, 30);
                onChange(n);
                setEditing(null);
              }}
            >
              保存
            </button>
          }
        >
          <label className="field">
            <span>名前</span>
            <input type="text" value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={30} />
          </label>
          <p className="muted small">これまでの記録のカテゴリー名は変わりません。</p>
        </Sheet>
      )}
    </Card>
  );
}

function CategorySettings() {
  const s = useSettings();
  if (!s) return null;
  return (
    <main>
      <PageHead title="カテゴリー" back="/settings" />
      <CategoryEditor title="支出のカテゴリー" list={s.expenseCategories} onChange={(l) => void saveSettings({ expenseCategories: l })} />
      <button type="button" className="btn ghost small" onClick={() => void saveSettings({ expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES] })}>
        支出のカテゴリーを初期状態に戻す
      </button>
      <CategoryEditor title="タスクのカテゴリー" list={s.taskCategories} onChange={(l) => void saveSettings({ taskCategories: l })} />
    </main>
  );
}

function DataSettings() {
  const sync = useStore(syncStatus);
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [confirm, setConfirm] = useState<'cache' | 'data' | null>(null);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    void getStorageInfo().then(setInfo);
  }, []);
  return (
    <main>
      <PageHead title="データの削除・アプリの更新" back="/settings" />
      <Card title="保存領域">
        <div className="kv">
          <span>データの保護（削除されにくくする）</span>
          <span>{info === null ? '確認中' : info.persisted ? '有効' : '未設定'}</span>
        </div>
        {info?.usage !== undefined && (
          <div className="kv">
            <span>使用量</span>
            <span>{Math.round((info.usage ?? 0) / 1024)} KB</span>
          </div>
        )}
        {info && !info.persisted && (
          <p className="small muted">ブラウザが空き容量不足のときにデータを消してしまわないよう、保護をお願いしています。ホーム画面から開くと有効になりやすくなります。</p>
        )}
      </Card>

      <Card title="アプリの更新・表示の不具合" icon="🔄">
        <p className="small">表示がおかしいときは、アプリの部品（キャッシュ）だけを消して読み込み直せます。<strong>記録したデータは消えません。</strong></p>
        <button type="button" className="btn block" onClick={() => setConfirm('cache')}>
          キャッシュを消して読み込み直す
        </button>
      </Card>

      <Card title="この端末のデータを削除" icon="🗑️">
        <p className="small">
          この端末に保存されている記録をすべて削除します。
          {sync.userId ? 'クラウドのデータは残ります（クラウドのデータを消すには「保存と同期」からアカウントを削除してください）。' : '端末にのみ保存しているため、削除すると元に戻せません。'}
        </p>
        <button type="button" className="btn danger block" onClick={() => setConfirm('data')}>
          この端末のデータを削除
        </button>
      </Card>

      {confirm === 'cache' && (
        <Confirm
          title="キャッシュを消しますか？"
          message={<p>アプリを最新の状態で読み込み直します。記録したデータはそのまま残ります。</p>}
          confirmLabel="読み込み直す"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void clearAppCache()}
        />
      )}
      {confirm === 'data' && (
        <Sheet title="データを削除" onClose={() => setConfirm(null)}>
          <p>
            この端末のすべての記録を削除します。<strong>元に戻せません。</strong>
          </p>
          {sync.userId && sync.pending > 0 && <p className="banner error small">クラウドに送れていない記録が {sync.pending} 件あります。削除するとその記録は失われます。</p>}
          <p className="small">
            必要なら、先に <a href={href('/settings/backup')}>バックアップを書き出して</a> ください。
          </p>
          <label className="field">
            <span>確認のため「削除」と入力してください</span>
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn danger block"
            disabled={typed !== '削除'}
            onClick={async () => {
              const db = getDb();
              const name = db.name;
              await db.delete();
              try {
                if (name === LOCAL_DB_NAME) localStorage.removeItem('lp.prefs');
              } catch {
                /* noop */
              }
              toast('データを削除しました');
              location.reload();
            }}
          >
            削除する
          </button>
        </Sheet>
      )}
    </main>
  );
}
