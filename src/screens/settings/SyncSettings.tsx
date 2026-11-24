import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/db';
import { PageHead, Card, Confirm, Sheet } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { href } from '../../ui/router';
import { useStore } from '../../lib/store';
import { syncStatus, syncNow, signIn, signUp, signOut, deleteAccount, resolveConflict, acceptMigration } from '../../sync/manager';
import { formatDateTime } from '../../lib/date';
import { useSyncLabel } from '../SyncBadge';
import { formatYen } from '../../lib/money';
import type { Conflict } from '../../db/types';
import { unsubscribeWebPush } from '../../notify/notifier';
import { toast } from '../../lib/events';

const TABLE_LABEL: Record<string, string> = {
  checklists: '持ち物リスト',
  checkItems: '持ち物',
  checkHistory: 'チェック履歴',
  tasks: 'タスク',
  subtasks: 'ステップ',
  transactions: 'お金の記録',
  fixedCosts: '固定費',
  savingsGoals: '貯金の目標',
  reminders: 'リマインダー',
  settings: '設定',
  weights: '体重',
};

export function SyncSettings() {
  const s = useStore(syncStatus);
  const label = useSyncLabel();
  const [busy, setBusy] = useState(false);
  const conflicts = useLiveQuery(() => getDb().conflicts.where('status').equals('pending').toArray(), [s.userId]);
  const rejected = useLiveQuery(() => getDb().outbox.filter((e) => e.blocked === 1 && e.lastError !== 'conflict').count(), [s.userId]);

  return (
    <main>
      <PageHead title="保存と同期" back="/settings" />
      <Card>
        <div className="row">
          <span className="status-dot" style={{ background: label.color }} aria-hidden="true" />
          <strong>{label.text}</strong>
        </div>
        {label.detail && <p className="muted small">{label.detail}</p>}
        {s.userId && (
          <>
            <div className="kv">
              <span>最終同期</span>
              <span>{formatDateTime(s.lastSyncAt)}</span>
            </div>
            <div className="kv">
              <span>同期待ち</span>
              <span>{s.pending}件</span>
            </div>
            {!!rejected && (
              <p className="banner error small">送信できなかった記録が {rejected} 件あります。端末には保存されています。バックアップの書き出しをおすすめします。</p>
            )}
            <button
              type="button"
              className="btn primary block"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await syncNow();
                setBusy(false);
              }}
            >
              <Icon name="sync" /> 今すぐ同期
            </button>
          </>
        )}
      </Card>

      {s.migrationOffer && <MigrationCard />}

      {conflicts && conflicts.length > 0 && (
        <Card title="確認が必要な記録" icon="⚠️">
          <p className="small">別の端末でも同じ記録が変更されていました。どちらの内容を残すか選んでください。選ぶまでは、どちらのデータも消えません。</p>
          {conflicts.map((c) => (
            <ConflictItem key={c.id} c={c} />
          ))}
        </Card>
      )}

      {!s.configured ? <NotConfigured /> : s.userId ? <Account email={s.email} /> : <AuthForm />}

      <Card title="この端末への保存について" icon="ℹ️">
        <ul className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>入力した内容は、すぐにこの端末（ブラウザ内のデータベース）に保存されます。通信がなくても使えます。</li>
          <li>
            <strong>端末だけに保存している場合、</strong>iPhone の故障・紛失、ホーム画面からアプリを削除したとき、Safari の「履歴とWebサイトデータを消去」をしたときなどに、データが消えることがあります。
          </li>
          <li>クラウド同期を使うか、定期的に <a href={href('/settings/backup')}>バックアップの書き出し</a> をしてください。</li>
          <li>iPhone では、Safari で開いた場合とホーム画面から開いた場合で、保存場所が別になります。ふだんはホーム画面から開いてください。</li>
        </ul>
      </Card>
    </main>
  );
}

function NotConfigured() {
  return (
    <Card title="クラウド同期" icon="☁️">
      <p className="small">このアプリにはクラウド同期の接続先がまだ設定されていません。いまは「この端末にのみ保存」モードで動いています。</p>
      <p className="small muted">開発者向け：DEPLOYMENT.md の「Supabase の設定」の手順で、環境変数 VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定すると有効になります。</p>
    </Card>
  );
}

function MigrationCard() {
  const [busy, setBusy] = useState(false);
  return (
    <Card title="この端末のデータを引き継ぎますか？" icon="📦" className="warn">
      <p className="small">ログインする前にこの端末で使っていたデータがあります。アカウントに引き継ぐと、クラウドに保存され、ほかの端末でも使えるようになります。</p>
      <div className="row wrap">
        <button
          type="button"
          className="btn primary grow"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await acceptMigration(true);
            toast('データを引き継ぎました');
          }}
        >
          引き継ぐ
        </button>
        <button type="button" className="btn grow" disabled={busy} onClick={() => void acceptMigration(false)}>
          引き継がない
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
        「引き継がない」を選んでも、端末のデータは消えません（ログアウトすると再び表示されます）。
      </p>
    </Card>
  );
}

function summarize(c: Record<string, unknown> | null, table: string): string {
  if (!c) return '（なし）';
  if (c.deleted) return '削除済み';
  if (table === 'transactions') return `${c.type === 'income' ? '収入' : '支出'} ${formatYen(Number(c.amount))} ・ ${c.category} ・ ${c.date}${c.memo ? ` ・ ${c.memo}` : ''}`;
  if (table === 'fixedCosts') return `${c.name} ${formatYen(Number(c.amount))}（毎月${c.dayOfMonth}日）`;
  if (table === 'savingsGoals') return `${c.name} ${formatYen(Number(c.savedAmount))} / ${formatYen(Number(c.targetAmount))}`;
  return String(c.title ?? c.name ?? c.label ?? '');
}

function ConflictItem({ c }: { c: Conflict }) {
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <strong>{TABLE_LABEL[c.table] ?? c.table}</strong>
      <div className="kv small">
        <span>この端末</span>
        <span>{summarize(c.local, c.table)}</span>
      </div>
      <div className="kv small">
        <span>クラウド</span>
        <span>{summarize(c.server, c.table)}</span>
      </div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button type="button" className="btn small grow" onClick={() => void resolveConflict(c.id, 'local')}>
          この端末の内容
        </button>
        <button type="button" className="btn small grow" onClick={() => void resolveConflict(c.id, 'server')}>
          クラウドの内容
        </button>
        {c.table === 'transactions' && (
          <button type="button" className="btn small grow" onClick={() => void resolveConflict(c.id, 'both')}>
            両方残す
          </button>
        )}
      </div>
    </div>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError('');
    setInfo('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('メールアドレスの形式を確認してください。');
    if (password.length < 8) return setError('パスワードは8文字以上にしてください。');
    setBusy(true);
    try {
      if (mode === 'signup') {
        const r = await signUp(email.trim(), password);
        if (r === 'confirm-email') setInfo('確認メールを送りました。メールのリンクを開いたあと、このアプリに戻って「ログイン」してください。');
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理できませんでした');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="クラウドバックアップ" icon="☁️">
      <p className="small">アカウントを作ると、データがクラウドにも保存され、機種変更やアプリの入れ直しのときに復元できます。アカウントを作らなくても、この端末だけで使えます。</p>
      <div className="segmented" role="group" aria-label="ログインか新規登録" style={{ marginBottom: 12 }}>
        <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>
          ログイン
        </button>
        <button type="button" aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>
          新規登録
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>メールアドレス</span>
          <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>パスワード（8文字以上）</span>
          <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="banner error small" role="alert">{error}</p>}
        {info && <p className="banner info small" role="status">{info}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>
          {mode === 'login' ? 'ログイン' : 'アカウントを作る'}
        </button>
      </form>
      <p className="muted small" style={{ marginTop: 8 }}>
        クラウドに保存されるデータについては <a href={href('/settings/privacy')}>プライバシーについて</a> をご覧ください。
      </p>
    </Card>
  );
}

function Account({ email }: { email: string | null }) {
  const [confirm, setConfirm] = useState<'logout' | 'logout-force' | 'delete' | null>(null);
  const [pending, setPending] = useState(0);
  const [deleteText, setDeleteText] = useState('');
  const [error, setError] = useState('');
  const doLogout = async (force: boolean) => {
    await unsubscribeWebPush();
    const r = await signOut(force);
    if (!r.ok) {
      setPending(r.pending);
      setConfirm('logout-force');
    } else {
      setConfirm(null);
      toast('ログアウトしました。この端末からアカウントのデータを消去しました。');
    }
  };
  return (
    <Card title="アカウント" icon="👤">
      <div className="kv">
        <span>ログイン中</span>
        <span style={{ overflowWrap: 'anywhere' }}>{email}</span>
      </div>
      <button type="button" className="btn block" onClick={() => setConfirm('logout')}>
        ログアウト
      </button>
      <button type="button" className="btn danger block" style={{ marginTop: 12 }} onClick={() => setConfirm('delete')}>
        アカウントとクラウドのデータを削除
      </button>
      {confirm === 'logout' && (
        <Confirm
          title="ログアウトしますか？"
          message={<p>ログアウトすると、この端末からアカウントのデータを消去します（クラウドには残ります）。再びログインすると復元されます。</p>}
          confirmLabel="ログアウト"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void doLogout(false)}
        />
      )}
      {confirm === 'logout-force' && (
        <Confirm
          title="まだ同期していない記録があります"
          message={
            <p>
              クラウドに送れていない記録が <strong>{pending}件</strong> あります。このままログアウトすると、その記録は失われます。
              通信できる場所で同期してからログアウトするか、先にバックアップを書き出してください。
            </p>
          }
          confirmLabel="失われてもよいのでログアウト"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => void doLogout(true)}
        />
      )}
      {confirm === 'delete' && (
        <Sheet title="アカウントを削除" onClose={() => setConfirm(null)}>
          <p>アカウントと、クラウドに保存されたすべてのデータを削除します。<strong>元に戻せません。</strong></p>
          <p className="small">必要なら、先に <a href={href('/settings/backup')}>バックアップを書き出して</a> ください。</p>
          <label className="field">
            <span>確認のため「削除」と入力してください</span>
            <input type="text" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} />
          </label>
          {error && <p className="banner error small">{error}</p>}
          <button
            type="button"
            className="btn danger block"
            disabled={deleteText !== '削除'}
            onClick={async () => {
              try {
                await unsubscribeWebPush();
                await deleteAccount();
                setConfirm(null);
                toast('アカウントを削除しました');
              } catch (e) {
                setError(e instanceof Error ? e.message : '削除できませんでした');
              }
            }}
          >
            完全に削除する
          </button>
        </Sheet>
      )}
    </Card>
  );
}
