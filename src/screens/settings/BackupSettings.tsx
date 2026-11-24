import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/db';
import { PageHead, Card, Sheet, Segmented } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { buildBackup, planImport, applyImport, undoLastRestore, shareOrDownload, type ImportPlan, type ConflictPolicy } from '../../backup/backup';
import { getMeta, setMeta } from '../../db/repo';
import { formatDateTime, today } from '../../lib/date';
import { transactionsToCsv } from '../../lib/money';
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
};

export function BackupSettings() {
  const meta = useLiveQuery(async () => {
    const db = getDb();
    return {
      lastBackupAt: await getMeta<string>('lastBackupAt', db),
      lastRestoreAt: await getMeta<string>('lastRestoreAt', db),
      canUndo: !!(await getMeta('preRestoreSnapshot', db)),
    };
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState('');

  const exportJson = async () => {
    const db = getDb();
    const data = await buildBackup(db);
    const r = await shareOrDownload(`lifepartner-backup-${today()}.json`, JSON.stringify(data), 'application/json');
    if (r !== 'cancelled') {
      await setMeta('lastBackupAt', new Date().toISOString(), db);
      toast('バックアップを書き出しました');
    }
  };

  const exportCsv = async () => {
    const db = getDb();
    const csv = transactionsToCsv(await db.transactions.toArray(), await db.fixedCosts.toArray());
    await shareOrDownload(`lifepartner-money-${today()}.csv`, csv, 'text/csv');
  };

  const onFile = async (f: File | undefined) => {
    setError('');
    if (!f) return;
    try {
      const text = await f.text();
      const p = await planImport(getDb(), text);
      if (!p.ok) setError(p.error ?? '読み込めませんでした');
      else setPlan(p);
    } catch {
      setError('ファイルを読み込めませんでした。');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <main>
      <PageHead title="バックアップ" back="/settings" />
      <Card title="書き出し" icon="💾">
        <p className="small">すべてのデータを1つのファイル（JSON）に書き出します。iPhone では「ファイルに保存」を選ぶと、iCloud Drive などに保存できます。</p>
        <div className="kv small">
          <span>最後のバックアップ</span>
          <span>{formatDateTime(meta?.lastBackupAt)}</span>
        </div>
        <button type="button" className="btn primary block" onClick={() => void exportJson()}>
          <Icon name="download" /> バックアップを書き出す
        </button>
        <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={() => void exportCsv()}>
          お金の記録をCSVで書き出す
        </button>
        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          バックアップファイルには金銭記録などの個人情報が含まれます。保存先や共有相手に気をつけてください。
        </p>
      </Card>

      <Card title="読み込み（復元）" icon="📂">
        <p className="small">書き出したバックアップファイルから復元します。いまのデータは消さずに、足りない記録を追加します。読み込む前に内容を確認できます。</p>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" id="backup-file" onChange={(e) => void onFile(e.target.files?.[0])} />
        <label htmlFor="backup-file" className="btn block" role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}>
          <Icon name="upload" /> ファイルを選ぶ
        </label>
        {error && (
          <p className="banner error small" role="alert" style={{ marginTop: 8 }}>
            {error}
          </p>
        )}
        <div className="kv small" style={{ marginTop: 8 }}>
          <span>最後の復元</span>
          <span>{formatDateTime(meta?.lastRestoreAt)}</span>
        </div>
        {meta?.canUndo && (
          <button
            type="button"
            className="btn block"
            onClick={async () => {
              if (await undoLastRestore(getDb())) toast('復元する前の状態に戻しました');
            }}
          >
            <Icon name="undo" /> 直前の復元を取り消す
          </button>
        )}
      </Card>
      {plan && <ImportPreview plan={plan} onClose={() => setPlan(null)} />}
    </main>
  );
}

function ImportPreview({ plan, onClose }: { plan: ImportPlan; onClose: () => void }) {
  const [policy, setPolicy] = useState<ConflictPolicy>('keep-existing');
  const [busy, setBusy] = useState(false);
  const nothing = plan.toAdd.length === 0 && (plan.conflicts.length === 0 || policy === 'keep-existing');
  return (
    <Sheet
      title="復元の内容を確認"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || nothing}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await applyImport(getDb(), plan, policy);
                toast(`復元しました（追加 ${r.added}件${r.replaced ? `・更新 ${r.replaced}件` : ''}）`);
                onClose();
              } catch {
                setBusy(false);
              }
            }}
          >
            復元する
          </button>
        </>
      }
    >
      <p className="small muted">バックアップ作成日時：{formatDateTime(plan.exportedAt)}</p>
      <div className="kv">
        <span>新しく追加される記録</span>
        <span>{plan.toAdd.length}件</span>
      </div>
      {Object.entries(plan.counts).map(([t, n]) => (
        <div key={t} className="kv small muted" style={{ paddingLeft: 12 }}>
          <span>{TABLE_LABEL[t] ?? t}</span>
          <span>{n}件</span>
        </div>
      ))}
      <div className="kv">
        <span>すでに同じ内容がある記録</span>
        <span>{plan.identical}件</span>
      </div>
      <div className="kv">
        <span>内容が違う記録</span>
        <span>{plan.conflicts.length}件</span>
      </div>
      {plan.invalid.length > 0 && (
        <p className="banner warn small">形式が正しくない {plan.invalid.length} 件は読み込みません。</p>
      )}
      {plan.conflicts.length > 0 && (
        <div className="field">
          <span className="muted small" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
            内容が違う記録の扱い
          </span>
          <Segmented<ConflictPolicy>
            label="内容が違う記録の扱い"
            value={policy}
            onChange={setPolicy}
            options={[
              { value: 'keep-existing', label: 'いまのデータを残す' },
              { value: 'newer-wins', label: '新しい方を使う' },
            ]}
          />
        </div>
      )}
      <p className="small muted">いまのデータは削除されません。復元前の状態は端末に保存され、「直前の復元を取り消す」で戻せます。</p>
      {nothing && <p className="banner info small">追加・更新される記録はありません。</p>}
    </Sheet>
  );
}
