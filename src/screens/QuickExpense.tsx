import { useState } from 'react';
import { Sheet, YenInput } from '../ui/components';
import { parseYen } from '../lib/money';
import { quickExpense, addTransaction } from '../db/actions';
import { useSettings } from '../ui/hooks';
import { catEmoji } from './useMoneyData';
import { today } from '../lib/date';
import { toast } from '../lib/events';
import { softDelete } from '../db/repo';

/**
 * 支出の簡易登録。
 * 金額を入れて、カテゴリーのボタンを押せば登録完了（2操作）。メモ・日付は任意。
 */
export function QuickExpense({ onClose, mode = 'expense' }: { onClose: () => void; mode?: 'expense' | 'income' }) {
  const settings = useSettings();
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [date, setDate] = useState(today());
  const [type, setType] = useState<'expense' | 'income'>(mode);
  const [busy, setBusy] = useState(false);
  const yen = parseYen(amount);
  const valid = yen !== null && yen > 0;

  const cats = type === 'expense' ? settings?.expenseCategories ?? [] : ['給料', 'その他'];

  const save = async (category: string) => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (type === 'expense' && date === today()) {
        await quickExpense(yen!, category, memo);
      } else {
        const tx = await addTransaction({ type, amount: yen!, category, memo, date });
        toast(`${type === 'income' ? '収入' : '支出'} ${yen!.toLocaleString('ja-JP')}円を記録しました`, () => softDelete('transactions', tx.id));
      }
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Sheet title={type === 'expense' ? '支出を記録' : '収入を記録'} onClose={onClose}>
      <div className="segmented" role="group" aria-label="種類" style={{ marginBottom: 12 }}>
        <button type="button" aria-pressed={type === 'expense'} onClick={() => setType('expense')}>
          支出
        </button>
        <button type="button" aria-pressed={type === 'income'} onClick={() => setType('income')}>
          収入
        </button>
      </div>
      <YenInput label="金額" value={amount} onChange={setAmount} autoFocus />
      <p className="muted small" style={{ marginTop: -6 }}>
        {valid ? 'カテゴリーを押すと記録されます' : '金額を入力してから、カテゴリーを押してください'}
      </p>
      <div className="cat-grid" style={{ marginBottom: 16 }}>
        {cats.map((c) => (
          <button key={c} type="button" className="cat-btn" disabled={!valid || busy} onClick={() => void save(c)} style={{ opacity: valid ? 1 : 0.55 }}>
            <span className="emoji" aria-hidden="true">
              {catEmoji(c)}
            </span>
            {c}
          </button>
        ))}
      </div>
      <details className="disclosure">
        <summary>メモ・日付（任意）</summary>
        <label className="field">
          <span>メモ</span>
          <input type="text" value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} placeholder="例：お昼ごはん" />
        </label>
        <label className="field">
          <span>日付</span>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        {type === 'income' && date > today() && (
          <p className="muted small">未来の日付の収入は、その日になるまで残高に含めません。</p>
        )}
      </details>
    </Sheet>
  );
}
