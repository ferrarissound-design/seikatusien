import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/db';
import { PageHead, Card, ProgressBar, Sheet, Empty, YenInput, Confirm, Segmented } from '../ui/components';
import { Icon } from '../ui/Icon';
import { href, useRoute, navigate } from '../ui/router';
import { useMoneyData, catEmoji } from './useMoneyData';
import { QuickExpense } from './QuickExpense';
import { formatYen, parseYen, monthlySummary, transactionsToCsv, MAX_AMOUNT } from '../lib/money';
import { formatJa, formatShort, monthKey, addMonths, isValidDateStr, today } from '../lib/date';
import { markFixedCostPaid, setBalance, deleteWithUndo } from '../db/actions';
import { createRecord, updateRecord, saveSettings } from '../db/repo';
import type { FixedCost, SavingsGoal, Transaction } from '../db/types';
import { shareOrDownload } from '../backup/backup';
import { toast } from '../lib/events';

export function MoneyScreen() {
  const route = useRoute();
  switch (route.path[1]) {
    case 'breakdown':
      return <Breakdown />;
    case 'history':
      return <History />;
    case 'fixed':
      return <FixedCosts />;
    case 'goals':
      return <Goals />;
    case 'summary':
      return <Summary />;
    case 'setup':
      return <MoneySetup />;
    default:
      return <MoneyHome />;
  }
}

function MoneyHome() {
  const m = useMoneyData();
  const [sheet, setSheet] = useState<'expense' | 'income' | 'balance' | null>(null);
  if (!m) return null;
  const a = m.allowance;
  const recent = m.transactions
    .filter((t) => !t.deleted)
    .sort((x, y) => y.date.localeCompare(x.date) || y.createdAt.localeCompare(x.createdAt))
    .slice(0, 5);

  return (
    <main>
      <PageHead title="お金" />
      <Card className="soft">
        <div className="muted small">今日使える金額（残り）</div>
        <div className="big-number" data-testid="money-today">{formatYen(a.todayRemaining)}</div>
        <div className="muted small">
          1日の目安 {formatYen(a.perDay)} ・ {a.period.hasPayday ? `給料日（${formatShort(a.period.nextPayday)}）まで ${a.period.daysUntilPayday}日` : `月末まで ${a.period.daysRemaining}日`}
        </div>
        {a.missing.includes('balance') && a.missing.includes('budget') && (
          <a className="btn primary block" style={{ marginTop: 12 }} href={href('/money/setup')}>
            残高・予算を登録する
          </a>
        )}
        {a.shortfall > 0 && (
          <p className="banner warn small" style={{ marginTop: 8, marginBottom: 0 }}>
            {formatYen(a.shortfall)} 足りない見込みです。
            <a href={href('/money/breakdown')}> 調整のヒントを見る</a>
          </p>
        )}
        <a className="btn ghost small" href={href('/money/breakdown')} style={{ marginTop: 4, paddingLeft: 0 }}>
          計算の内訳を見る <Icon name="chev" size={18} />
        </a>
      </Card>

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary grow" onClick={() => setSheet('expense')}>
          <Icon name="plus" /> 支出
        </button>
        <button type="button" className="btn grow" onClick={() => setSheet('income')}>
          <Icon name="plus" /> 収入
        </button>
      </div>

      <Card title="残高と予算">
        <div className="kv">
          <span>いまの残高</span>
          <span>{a.balance === null ? '未登録' : formatYen(a.balance)}</span>
        </div>
        <button type="button" className="btn small" onClick={() => setSheet('balance')}>
          残高を登録し直す
        </button>
        {a.budget !== null && (
          <>
            <div className="divider" />
            <div className="kv">
              <span>予算の残り</span>
              <span>{formatYen(a.budgetRemaining ?? 0)}</span>
            </div>
            <ProgressBar value={a.budgetSpent} max={a.budget} label="予算の消化率" tone={a.budgetSpent > a.budget ? 'accent' : undefined} />
            <div className="spread small muted" style={{ marginTop: 4 }}>
              <span>使った {formatYen(a.budgetSpent)}</span>
              <span>消化率 {a.budget > 0 ? Math.round((a.budgetSpent / a.budget) * 100) : 0}%</span>
            </div>
            <PeriodProgress start={a.period.start} next={a.period.nextPayday} today={m.todayStr} />
          </>
        )}
      </Card>

      {a.upcomingFixed.length > 0 && (
        <Card title="これからの固定費">
          <ul className="list">
            {a.upcomingFixed.map((u) => (
              <li key={`${u.fixedCost.id}:${u.period}`} className="row" style={{ minHeight: 56 }}>
                <div className="grow">
                  <div>{u.fixedCost.name}</div>
                  <div className="muted small">
                    {formatShort(u.dueDate)}
                    {u.overdue && ' ・ 支払日を過ぎています'}
                  </div>
                </div>
                <span className="num">{formatYen(u.fixedCost.amount)}</span>
                <button type="button" className="btn small" onClick={() => void markFixedCostPaid(u.fixedCost, u.period)}>
                  支払った
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="最近の記録"
        action={
          <a className="btn ghost small" href={href('/money/history')}>
            すべて
          </a>
        }
      >
        {recent.length === 0 ? <p className="muted">まだ記録はありません。</p> : <TxList txs={recent} />}
      </Card>

      <Card title="メニュー">
        <nav className="menu-list" aria-label="お金のメニュー">
          <a href={href('/money/summary')}>📊 月別・カテゴリー別の集計 <span className="chev"><Icon name="chev" /></span></a>
          <a href={href('/money/fixed')}>📅 固定費 <span className="chev"><Icon name="chev" /></span></a>
          <a href={href('/money/goals')}>🎯 貯金の目標 <span className="chev"><Icon name="chev" /></span></a>
          <a href={href('/money/setup')}>⚙️ 給料日・予算・残高の設定 <span className="chev"><Icon name="chev" /></span></a>
        </nav>
      </Card>

      {(sheet === 'expense' || sheet === 'income') && <QuickExpense mode={sheet} onClose={() => setSheet(null)} />}
      {sheet === 'balance' && <BalanceSheet current={a.balance} onClose={() => setSheet(null)} />}
    </main>
  );
}

function PeriodProgress({ start, next, today }: { start: string; next: string; today: string }) {
  const total = Math.max(1, (Date.parse(next) - Date.parse(start)) / 86400000);
  const passed = Math.max(0, (Date.parse(today) - Date.parse(start)) / 86400000 + 1);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="spread small muted">
        <span>期間の経過</span>
        <span>
          {formatShort(start)} 〜 {formatShort(next)}
        </span>
      </div>
      <ProgressBar value={passed} max={total} label="給料日までの期間の経過" tone="accent" />
    </div>
  );
}

function TxList({ txs }: { txs: Transaction[] }) {
  const [editing, setEditing] = useState<Transaction | null>(null);
  return (
    <>
      <ul className="list">
        {txs.map((t) => (
          <li key={t.id}>
            <button type="button" className="check-row" onClick={() => setEditing(t)} aria-label={`${t.category} ${formatYen(t.amount)} を編集`}>
              <span aria-hidden="true" style={{ fontSize: '1.3rem' }}>
                {catEmoji(t.category)}
              </span>
              <span className="label-text">
                {t.category}
                {t.memo && <span className="muted small"> ・ {t.memo}</span>}
                <span className="muted small" style={{ display: 'block' }}>
                  {formatShort(t.date)}
                  {t.fixedCostId && ' ・ 固定費'}
                </span>
              </span>
              <span className="num" style={{ fontWeight: 700, color: t.type === 'income' ? 'var(--ok)' : 'var(--text)' }}>
                {t.type === 'income' ? '+' : '−'}
                {formatYen(t.amount)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editing && <TxEditSheet tx={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TxEditSheet({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const m = useMoneyData();
  const [amount, setAmount] = useState(String(tx.amount));
  const [category, setCategory] = useState(tx.category);
  const [memo, setMemo] = useState(tx.memo);
  const [date, setDate] = useState(tx.date);
  const [type, setType] = useState(tx.type);
  const yen = parseYen(amount);
  const valid = yen !== null && yen > 0 && isValidDateStr(date);
  const cats = Array.from(new Set([...(m?.settings.expenseCategories ?? []), '給料', tx.category]));
  return (
    <Sheet
      title="記録を編集"
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              void deleteWithUndo('transactions', tx.id, '記録');
              onClose();
            }}
          >
            <Icon name="trash" size={20} /> 削除
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!valid}
            onClick={async () => {
              await updateRecord<Transaction>('transactions', tx.id, { amount: yen!, category, memo: memo.slice(0, 1000), date, type });
              onClose();
            }}
          >
            保存
          </button>
        </>
      }
    >
      <Segmented
        label="種類"
        value={type}
        onChange={setType}
        options={[
          { value: 'expense', label: '支出' },
          { value: 'income', label: '収入' },
        ]}
      />
      <div style={{ height: 12 }} />
      <YenInput label="金額" value={amount} onChange={setAmount} />
      <label className="field">
        <span>カテゴリー</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>メモ</span>
        <input type="text" value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} />
      </label>
      <label className="field">
        <span>日付</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
    </Sheet>
  );
}

function BalanceSheet({ current, onClose }: { current: number | null; onClose: () => void }) {
  const [v, setV] = useState(current !== null && current >= 0 ? String(current) : '');
  const yen = parseYen(v);
  return (
    <Sheet
      title="いまの残高を登録"
      onClose={onClose}
      actions={
        <button
          type="button"
          className="btn primary"
          disabled={yen === null}
          onClick={async () => {
            await setBalance(yen!);
            toast('残高を登録しました');
            onClose();
          }}
        >
          登録する
        </button>
      }
    >
      <p className="muted small">お財布や口座で、給料日まで自由に使えるお金の合計を入れてください。これ以降に記録した収入・支出で自動的に増減します。</p>
      <YenInput label="いまの残高" value={v} onChange={setV} autoFocus />
    </Sheet>
  );
}

function Breakdown() {
  const m = useMoneyData();
  if (!m) return null;
  const a = m.allowance;
  return (
    <main>
      <PageHead title="計算の内訳" back="/money" />
      <Card>
        <p className="small muted">今日使える金額は、次の式で計算しています（登録された情報にもとづく目安です）。</p>
        <p className="small" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>
          （いまの残高 − これから払う固定費 − 確保したい貯金）÷ 給料日までの日数
          <br />
          ※ 予算を設定している場合は、予算の残りと比べて少ない方を使います。
        </p>
        <div className="kv">
          <span>いまの残高（今日の支出前）</span>
          <span>{a.balance === null ? '未登録' : formatYen(a.balance + a.spentToday)}</span>
        </div>
        <div className="kv">
          <span>− これから払う固定費</span>
          <span>{formatYen(a.upcomingFixedTotal)}</span>
        </div>
        {a.upcomingFixed.map((u) => (
          <div key={`${u.fixedCost.id}:${u.period}`} className="kv small muted" style={{ paddingLeft: 12 }}>
            <span>
              {u.fixedCost.name}（{formatShort(u.dueDate)}）
            </span>
            <span>{formatYen(u.fixedCost.amount)}</span>
          </div>
        ))}
        <div className="kv">
          <span>− 確保したい貯金</span>
          <span>{formatYen(a.reserve)}</span>
        </div>
        <div className="kv total">
          <span>残高から使える金額</span>
          <span>{a.availableByBalance === null ? '—' : formatYen(a.availableByBalance)}</span>
        </div>
        {a.budget !== null && (
          <>
            <div className="divider" />
            <div className="kv">
              <span>予算</span>
              <span>{formatYen(a.budget)}</span>
            </div>
            <div className="kv">
              <span>− 使った金額（今日より前）</span>
              <span>{formatYen(a.budgetSpent - a.spentToday)}</span>
            </div>
            <div className="kv total">
              <span>予算から使える金額</span>
              <span>{formatYen(a.budget - (a.budgetSpent - a.spentToday))}</span>
            </div>
          </>
        )}
        <div className="divider" />
        <div className="kv">
          <span>使う金額の基準</span>
          <span>{a.limitedBy === 'budget' ? '予算の残り' : a.limitedBy === 'balance' ? '残高' : '—'}</span>
        </div>
        <div className="kv">
          <span>÷ 残り日数（今日を含む）</span>
          <span>{a.period.daysRemaining}日</span>
        </div>
        <div className="kv total">
          <span>1日の目安</span>
          <span>{formatYen(a.perDay)}</span>
        </div>
        <div className="kv">
          <span>今日使った金額</span>
          <span>{formatYen(a.spentToday)}</span>
        </div>
        <div className="kv total">
          <span>今日の残り</span>
          <span>{formatYen(a.todayRemaining)}</span>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          期間：{formatJa(a.period.start, false)} 〜 {formatJa(a.period.nextPayday, false)}の前日
          {!a.period.hasPayday && '（給料日が未設定のため、月末までで計算）'}
          <br />
          未来の日付の収入（まだ入っていないお金）は残高に含めていません。支払済みにした固定費は差し引いていません。
        </p>
      </Card>
      {a.shortfall > 0 && (
        <Card title="調整のヒント" icon="🌱" className="warn">
          <p>今のままだと {formatYen(a.shortfall)} 足りない見込みです。あわてなくて大丈夫です。できそうなことから選んでください。</p>
          <ul className="small" style={{ paddingLeft: '1.2em' }}>
            {a.reserve > 0 && <li>今回は「確保したい貯金」を少し減らす（{formatYen(a.reserve)} → 設定で変更）</li>}
            {a.upcomingFixed.length > 0 && <li>支払日を変えられる固定費がないか確認する</li>}
            <li>次の給料日まで、急ぎでない買い物を後回しにする</li>
            <li>残高の登録が古い場合は、いまの金額で登録し直す</li>
            <li>困ったときは、家族や支援機関など信頼できる人に相談する</li>
          </ul>
          <a className="btn block" href={href('/money/setup')}>
            設定を見直す
          </a>
        </Card>
      )}
      {a.missing.length > 0 && (
        <Card>
          <p className="small">
            まだ登録されていない項目：
            {a.missing.map((x) => ({ balance: '残高', payday: '給料日', budget: '予算' })[x]).join('、')}
          </p>
          <a className="btn block" href={href('/money/setup')}>
            登録する
          </a>
        </Card>
      )}
    </main>
  );
}

function History() {
  const m = useMoneyData();
  const [month, setMonth] = useState(monthKey(today()));
  if (!m) return null;
  const txs = m.transactions.filter((t) => !t.deleted && monthKey(t.date) === month).sort((x, y) => y.date.localeCompare(x.date) || y.createdAt.localeCompare(x.createdAt));
  const s = monthlySummary(m.transactions, month);
  const [y, mo] = month.split('-').map(Number);
  return (
    <main>
      <PageHead title="記録の一覧" back="/money" />
      <MonthPicker month={month} setMonth={setMonth} />
      <Card>
        <div className="kv">
          <span>収入</span>
          <span>{formatYen(s.income)}</span>
        </div>
        <div className="kv">
          <span>支出</span>
          <span>{formatYen(s.expense)}</span>
        </div>
      </Card>
      <Card title={`${y}年${mo}月の記録`}>{txs.length ? <TxList txs={txs} /> : <p className="muted">この月の記録はありません。</p>}</Card>
      <button
        type="button"
        className="btn block"
        style={{ marginTop: 12 }}
        onClick={() => void shareOrDownload(`lifepartner-money-${today()}.csv`, transactionsToCsv(m.transactions, m.fixedCosts), 'text/csv')}
      >
        <Icon name="download" size={20} /> すべての記録をCSVで書き出す
      </button>
    </main>
  );
}

function MonthPicker({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const [y, mo] = month.split('-').map(Number);
  const shift = (n: number) => setMonth(addMonths(`${month}-01`, n).slice(0, 7));
  return (
    <div className="spread" style={{ marginBottom: 8 }}>
      <button type="button" className="icon-btn" aria-label="前の月" onClick={() => shift(-1)}>
        <Icon name="back" />
      </button>
      <strong aria-live="polite">
        {y}年{mo}月
      </strong>
      <button type="button" className="icon-btn" aria-label="次の月" onClick={() => shift(1)}>
        <Icon name="chev" />
      </button>
    </div>
  );
}

function Summary() {
  const m = useMoneyData();
  const [month, setMonth] = useState(monthKey(today()));
  if (!m) return null;
  const s = monthlySummary(m.transactions, month);
  const max = Math.max(1, ...s.byCategory.map((c) => c.amount));
  const months = Array.from({ length: 6 }, (_, i) => addMonths(`${month}-01`, i - 5).slice(0, 7)).map((mk) => monthlySummary(m.transactions, mk));
  const maxM = Math.max(1, ...months.map((x) => Math.max(x.expense, x.income)));
  return (
    <main>
      <PageHead title="集計" back="/money" />
      <MonthPicker month={month} setMonth={setMonth} />
      <Card title="カテゴリー別の支出">
        {s.byCategory.length === 0 ? (
          <p className="muted">この月の支出はありません。</p>
        ) : (
          s.byCategory.map((c) => (
            <div key={c.category} className="bar-row">
              <span>
                {catEmoji(c.category)} {c.category}
              </span>
              <ProgressBar value={c.amount} max={max} label={`${c.category}の支出`} />
              <span className="num">{formatYen(c.amount)}</span>
            </div>
          ))
        )}
        <div className="kv total">
          <span>支出の合計</span>
          <span>{formatYen(s.expense)}</span>
        </div>
      </Card>
      <Card title="月ごとの推移（支出）">
        {months.map((x) => (
          <div key={x.month} className="bar-row">
            <span>{Number(x.month.slice(5))}月</span>
            <ProgressBar value={x.expense} max={maxM} label={`${x.month}の支出`} tone="accent" />
            <span className="num">{formatYen(x.expense)}</span>
          </div>
        ))}
        <p className="muted small" style={{ marginBottom: 0 }}>
          表の数字が正確な値です。バーは目安です。
        </p>
      </Card>
    </main>
  );
}

function FixedCosts() {
  const list = useLiveQuery(async () => (await getDb().fixedCosts.toArray()).filter((f) => !f.deleted).sort((a, b) => a.dayOfMonth - b.dayOfMonth), []);
  const [editing, setEditing] = useState<FixedCost | 'new' | null>(null);
  if (!list) return null;
  const total = list.filter((f) => f.active).reduce((s, f) => s + f.amount, 0);
  return (
    <main>
      <PageHead title="固定費" back="/money" />
      <p className="muted small">家賃・スマホ代など、毎月決まって払うお金を登録すると「今日使える金額」から自動で差し引きます。払ったら「支払った」を押すと、二重に差し引かれません。</p>
      <Card>
        {list.length === 0 ? (
          <Empty emoji="📅">まだ登録されていません。</Empty>
        ) : (
          <ul className="list">
            {list.map((f) => (
              <li key={f.id}>
                <button type="button" className="check-row" onClick={() => setEditing(f)}>
                  <span className="label-text">
                    {f.name}
                    <span className="muted small" style={{ display: 'block' }}>
                      毎月{f.dayOfMonth}日{!f.active && ' ・ 停止中'}
                    </span>
                  </span>
                  <span className="num">{formatYen(f.amount)}</span>
                  <Icon name="chev" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="kv total">
          <span>毎月の合計</span>
          <span>{formatYen(total)}</span>
        </div>
      </Card>
      <button type="button" className="btn primary fab" onClick={() => setEditing('new')}>
        <Icon name="plus" /> 追加
      </button>
      {editing && <FixedCostSheet fc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

function FixedCostSheet({ fc, onClose }: { fc: FixedCost | null; onClose: () => void }) {
  const [name, setName] = useState(fc?.name ?? '');
  const [amount, setAmount] = useState(fc ? String(fc.amount) : '');
  const [day, setDay] = useState(fc?.dayOfMonth ?? 27);
  const [active, setActive] = useState(fc ? !!fc.active : true);
  const [confirmDel, setConfirmDel] = useState(false);
  const yen = parseYen(amount);
  const valid = !!name.trim() && yen !== null && yen > 0;
  const save = async () => {
    if (!valid) return;
    const data = { name: name.trim().slice(0, 100), amount: yen!, dayOfMonth: day, category: '固定費', active: (active ? 1 : 0) as 0 | 1 };
    if (fc) await updateRecord<FixedCost>('fixedCosts', fc.id, data);
    else await createRecord<FixedCost>('fixedCosts', data);
    onClose();
  };
  if (confirmDel && fc) {
    return (
      <Confirm
        title="固定費を削除しますか？"
        message={<p>「{fc.name}」を削除します。これまでの支払記録は残ります。</p>}
        confirmLabel="削除する"
        danger
        onCancel={() => setConfirmDel(false)}
        onConfirm={() => {
          void deleteWithUndo('fixedCosts', fc.id, `「${fc.name}」`);
          onClose();
        }}
      />
    );
  }
  return (
    <Sheet
      title={fc ? '固定費を編集' : '固定費を追加'}
      onClose={onClose}
      actions={
        <>
          {fc && (
            <button type="button" className="btn danger" onClick={() => setConfirmDel(true)}>
              削除
            </button>
          )}
          <button type="button" className="btn primary" disabled={!valid} onClick={() => void save()}>
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span>名前</span>
        <input type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="例：家賃、スマホ代" />
      </label>
      <YenInput label="金額" value={amount} onChange={setAmount} />
      <label className="field">
        <span>毎月の支払日</span>
        <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}日{d >= 29 ? '（ない月は月末）' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="row" style={{ minHeight: 48 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 24, height: 24 }} />
        <span>計算に含める（解約したらオフ）</span>
      </label>
    </Sheet>
  );
}

function Goals() {
  const goals = useLiveQuery(async () => (await getDb().savingsGoals.toArray()).filter((g) => !g.deleted), []);
  const [editing, setEditing] = useState<SavingsGoal | 'new' | null>(null);
  if (!goals) return null;
  return (
    <main>
      <PageHead title="貯金の目標" back="/money" />
      <p className="muted small">目標と、いま貯まっている金額を記録できます。給料日までに残しておきたい金額は「給料日・予算・残高の設定」で設定します。</p>
      {goals.length === 0 && (
        <Card>
          <Empty emoji="🎯">まだ目標はありません。</Empty>
        </Card>
      )}
      {goals.map((g) => (
        <Card key={g.id} title={g.name} action={<button type="button" className="btn ghost small" onClick={() => setEditing(g)}>編集</button>}>
          <div className="spread small">
            <span className="num">{formatYen(g.savedAmount)}</span>
            <span className="muted num">目標 {formatYen(g.targetAmount)}</span>
          </div>
          <ProgressBar value={g.savedAmount} max={g.targetAmount} label={`${g.name}の達成度`} />
          <p className="muted small" style={{ marginTop: 6, marginBottom: 0 }}>
            {g.savedAmount >= g.targetAmount ? '目標に届きました' : `あと ${formatYen(g.targetAmount - g.savedAmount)}`}
          </p>
        </Card>
      ))}
      <button type="button" className="btn primary fab" onClick={() => setEditing('new')}>
        <Icon name="plus" /> 目標を追加
      </button>
      {editing && <GoalSheet goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

function GoalSheet({ goal, onClose }: { goal: SavingsGoal | null; onClose: () => void }) {
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? String(goal.targetAmount) : '');
  const [saved, setSaved] = useState(goal ? String(goal.savedAmount) : '0');
  const t = parseYen(target);
  const s = parseYen(saved);
  const valid = !!name.trim() && t !== null && t > 0 && s !== null;
  return (
    <Sheet
      title={goal ? '目標を編集' : '目標を追加'}
      onClose={onClose}
      actions={
        <>
          {goal && (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                void deleteWithUndo('savingsGoals', goal.id, '目標');
                onClose();
              }}
            >
              削除
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!valid}
            onClick={async () => {
              const data = { name: name.trim().slice(0, 100), targetAmount: t!, savedAmount: s! };
              if (goal) await updateRecord<SavingsGoal>('savingsGoals', goal.id, data);
              else await createRecord<SavingsGoal>('savingsGoals', data);
              onClose();
            }}
          >
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span>目標の名前</span>
        <input type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="例：旅行、もしものため" />
      </label>
      <YenInput label="目標金額" value={target} onChange={setTarget} />
      <YenInput label="いま貯まっている金額" value={saved} onChange={setSaved} />
    </Sheet>
  );
}

export function MoneySetup({ embedded, onDone }: { embedded?: boolean; onDone?: () => void }) {
  const m = useMoneyData();
  const [payday, setPayday] = useState<string | null>(null);
  const [rule, setRule] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [reserve, setReserve] = useState<string | null>(null);
  const [balance, setBal] = useState<string | null>(null);
  if (!m) return null;
  const s = m.settings;
  const pd = payday ?? (s.paydayDay ? String(s.paydayDay) : '');
  const rl = rule ?? s.paydayWeekendRule;
  const bg = budget ?? (s.monthlyBudget !== null ? String(s.monthlyBudget) : '');
  const rs = reserve ?? String(s.reserveAmount || '');
  const bl = balance ?? '';
  const bgYen = bg === '' ? null : parseYen(bg);
  const rsYen = rs === '' ? 0 : parseYen(rs);
  const blYen = bl === '' ? null : parseYen(bl);
  const valid = (bg === '' || bgYen !== null) && rsYen !== null && (bl === '' || blYen !== null);

  const save = async () => {
    if (!valid) return;
    await saveSettings({
      paydayDay: pd ? Number(pd) : null,
      paydayWeekendRule: rl as typeof s.paydayWeekendRule,
      monthlyBudget: bgYen,
      reserveAmount: Math.min(rsYen ?? 0, MAX_AMOUNT),
    });
    if (blYen !== null) await setBalance(blYen);
    toast('お金の設定を保存しました');
    if (onDone) onDone();
    else navigate('/money', true);
  };

  const body = (
    <>
      <Card title="給料日">
        <label className="field">
          <span>毎月の給料日</span>
          <select value={pd} onChange={(e) => setPayday(e.target.value)}>
            <option value="">設定しない（月末までで計算）</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}日{d >= 29 ? '（ない月は月末）' : ''}
              </option>
            ))}
          </select>
        </label>
        {pd && (
          <label className="field">
            <span>給料日が土日のとき</span>
            <select value={rl} onChange={(e) => setRule(e.target.value)}>
              <option value="before">前の金曜日</option>
              <option value="after">次の月曜日</option>
              <option value="none">そのまま</option>
            </select>
          </label>
        )}
        <p className="muted small" style={{ margin: 0 }}>祝日の調整には対応していません。</p>
      </Card>
      <Card title="いまの残高">
        <p className="muted small">
          {m.allowance.balance === null ? '未登録です。' : `現在の計算上の残高：${formatYen(m.allowance.balance)}。`}
          入力すると、この金額で登録し直します（空欄なら変更しません）。
        </p>
        <YenInput label="いまの残高" value={bl} onChange={setBal} placeholder="変更しない" />
      </Card>
      <Card title="予算と貯金">
        <YenInput label="給料日までの予算（固定費を除く）" value={bg} onChange={setBudget} placeholder="設定しない" />
        <YenInput label="給料日までに確保したい貯金" value={rs} onChange={setReserve} placeholder="0" />
      </Card>
    </>
  );
  if (embedded) {
    return (
      <>
        {body}
        <button type="button" className="btn primary block" style={{ marginTop: 12 }} disabled={!valid} onClick={() => void save()}>
          保存して次へ
        </button>
      </>
    );
  }
  return (
    <main>
      <PageHead title="お金の設定" back="/money" />
      {body}
      <button type="button" className="btn primary block" style={{ marginTop: 12 }} disabled={!valid} onClick={() => void save()}>
        保存
      </button>
    </main>
  );
}
