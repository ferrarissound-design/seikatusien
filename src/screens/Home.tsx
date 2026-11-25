import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/db';
import { Card, CheckRow, ProgressBar, Empty } from '../ui/components';
import { Icon } from '../ui/Icon';
import { href, navigate } from '../ui/router';
import { useSettings, useToday } from '../ui/hooks';
import { formatJa, formatShort, addDays, diffDays } from '../lib/date';
import { formatYen, fixedCostDueDates, getPayPeriod } from '../lib/money';
import { toggleCheckItem, setTaskDone } from '../db/actions';
import { useMoneyData } from './useMoneyData';
import { moneyCardState } from './moneyCardState';
import { QuickExpense } from './QuickExpense';
import { SyncBadge } from './SyncBadge';
import { BackupNudge } from './BackupNudge';
import { TaskSheet } from './Tasks';
import { WeightSheet } from './Weight';
import { formatKg, formatDiff, sortNewestFirst } from '../lib/weight';
import type { CheckItem } from '../db/types';

export function Home() {
  const settings = useSettings();
  const todayStr = useToday();
  const [sheet, setSheet] = useState<'expense' | 'task' | 'weight' | null>(null);
  if (!settings) return null;
  const f = settings.features;

  return (
    <main>
      <header style={{ paddingTop: 8 }}>
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}icons/brand-heart.svg`} alt="" aria-hidden="true" width={20} height={20} />
          <span>Life Partner</span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          今日は
        </p>
        <h1 style={{ marginTop: 0 }}>{formatJa(todayStr)}</h1>
        <SyncBadge />
      </header>

      <BackupNudge />

      <Notices />

      {f.money && <MoneyCard onAdd={() => setSheet('expense')} />}
      {f.checklists && <ChecklistCard />}
      {f.tasks && <TodayTasksCard onAdd={() => setSheet('task')} />}
      {f.weight && <WeightCard onAdd={() => setSheet('weight')} />}
      <UpcomingCard />

      <Card title="ショートカット">
        <div className="shortcuts">
          {f.money && (
            <button type="button" className="shortcut" onClick={() => setSheet('expense')}>
              <span className="emoji" aria-hidden="true">💸</span>支出を記録
            </button>
          )}
          {f.tasks && (
            <button type="button" className="shortcut" onClick={() => setSheet('task')}>
              <span className="emoji" aria-hidden="true">✏️</span>タスク追加
            </button>
          )}
          {f.tasks && (
            <a className="shortcut" href={href('/focus')}>
              <span className="emoji" aria-hidden="true">🎯</span>集中モード
            </a>
          )}
          {f.checklists && (
            <a className="shortcut" href={href('/checklists')}>
              <span className="emoji" aria-hidden="true">🎒</span>持ち物
            </a>
          )}
          {f.money && (
            <a className="shortcut" href={href('/money')}>
              <span className="emoji" aria-hidden="true">👛</span>お金
            </a>
          )}
          <a className="shortcut" href={href('/settings/backup')}>
            <span className="emoji" aria-hidden="true">💾</span>バックアップ
          </a>
        </div>
      </Card>

      <div className="gentle-card">
        <span className="gentle-icon" aria-hidden="true">
          🌱
        </span>
        <p>ひとつずつで、大丈夫。</p>
      </div>

      {sheet === 'expense' && <QuickExpense onClose={() => setSheet(null)} />}
      {sheet === 'task' && <TaskSheet onClose={() => setSheet(null)} defaultDue={todayStr} />}
      {sheet === 'weight' && <WeightSheet entry={null} onClose={() => setSheet(null)} />}
    </main>
  );
}

function Notices() {
  const notices = useLiveQuery(() => getDb().notices.where('read').equals(0).toArray(), []);
  if (!notices?.length) return null;
  return (
    <section aria-label="お知らせ" style={{ marginBottom: 12 }}>
      {notices.slice(-3).map((n) => (
        <div key={n.id} className="banner info spread" role="status">
          <div>
            <strong>
              <span aria-hidden="true">🔔 </span>
              {n.title}
            </strong>
            <div className="small">{n.body}</div>
          </div>
          <button type="button" className="icon-btn" aria-label="お知らせを閉じる" onClick={() => void getDb().notices.update(n.id, { read: 1 })}>
            <Icon name="close" size={20} />
          </button>
        </div>
      ))}
    </section>
  );
}

function MoneyCard({ onAdd }: { onAdd: () => void }) {
  const m = useMoneyData();
  if (!m) return null;
  const a = m.allowance;
  const state = moneyCardState(m.settings, m.transactions);

  // 未設定・記録のみ：金額（0円）は表示しない
  if (state !== 'ready') {
    return (
      <Card
        title="1日あたりの目安"
        icon="👛"
        action={
          <a className="btn ghost small" href={href('/money/breakdown')}>
            計算の内訳
          </a>
        }
      >
        <div data-testid="money-card" data-state={state}>
          {state === 'unset' ? (
            <>
              <p className="muted">残高か予算を登録すると、給料日まで1日あたりに使える目安を計算します。</p>
              <a className="btn primary block" href={href('/money/setup')}>
                お金の設定をする
              </a>
              <button type="button" className="btn outline block" style={{ marginTop: 12 }} onClick={onAdd}>
                <Icon name="plus" /> 支出を記録
              </button>
            </>
          ) : (
            <>
              <p className="muted">残高か予算を登録すると、1日の目安が出ます。</p>
              <button type="button" className="btn primary block" onClick={onAdd}>
                <Icon name="plus" /> 支出を記録
              </button>
              <a className="btn outline block" style={{ marginTop: 12 }} href={href('/money/setup')}>
                お金の設定をする
              </a>
            </>
          )}
        </div>
      </Card>
    );
  }

  return (
    <section className="money-hero" data-testid="money-card" data-state="ready" aria-labelledby="money-hero-title">
      <div className="money-hero-head">
        <h2 id="money-hero-title">
          <span aria-hidden="true">👛</span>1日あたりの目安
        </h2>
        <a className="money-hero-link" href={href('/money/breakdown')}>
          計算の内訳 <Icon name="chev" size={18} />
        </a>
      </div>
      <p className="hero-amount num" data-testid="daily-allowance">
        {formatYen(a.perDay)}
        <small>／日</small>
      </p>
      <p className="hero-caption">
        {a.period.hasPayday ? '次の給料日まで' : '今月末まで'}、今日を含めて <strong className="num">{a.period.daysRemaining}日</strong>
      </p>
      {a.spentToday > 0 && (
        <p className="hero-caption">
          今日使った {formatYen(a.spentToday)} ・ 今日の残り {formatYen(a.todayRemaining)}
        </p>
      )}
      <div className="hero-divider" aria-hidden="true" />
      <div className="hero-balance">
        <span>いまの残高</span>
        <strong className="num">{a.balance === null ? '未登録' : formatYen(a.balance)}</strong>
      </div>
      {a.budget !== null && (
        <div className="hero-budget">
          <div className="hero-balance">
            <span>予算の使用</span>
            <span className="num">
              {formatYen(a.budgetSpent)} / {formatYen(a.budget)}
            </span>
          </div>
          <ProgressBar value={a.budgetSpent} max={a.budget} label="予算の使用状況" />
        </div>
      )}
      {a.shortfall > 0 && (
        <p className="banner warn small" style={{ marginTop: 12, marginBottom: 0 }}>
          予定より {formatYen(a.shortfall)} 足りない見込みです。「計算の内訳」で調整方法を確認できます。
        </p>
      )}
      <button type="button" className="btn hero-button block" onClick={onAdd}>
        <Icon name="plus" /> 支出を記録
      </button>
      <p className="hero-note">※ 登録された情報にもとづく目安です。</p>
    </section>
  );
}

function ChecklistCard() {
  const data = useLiveQuery(async () => {
    const db = getDb();
    const lists = (await db.checklists.toArray()).filter((c) => !c.deleted && !c.isTemplate && c.showOnHome !== 0).sort((a, b) => a.sortOrder - b.sortOrder);
    const items = (await db.checkItems.toArray()).filter((i) => !i.deleted);
    return { lists, items };
  }, []);
  const [idx, setIdx] = useState(0);
  if (!data) return null;
  if (!data.lists.length) {
    return (
      <Card title="忘れ物チェック" icon="🎒">
        <Empty emoji="🎒">
          <p>持ち物リストを作ると、ここですぐ確認できます。</p>
          <a className="btn primary" href={href('/checklists?new=1')}>
            リストを作る
          </a>
        </Empty>
      </Card>
    );
  }
  const list = data.lists[Math.min(idx, data.lists.length - 1)];
  const items: CheckItem[] = data.items.filter((i) => i.checklistId === list.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const done = items.filter((i) => i.checked).length;
  return (
    <Card
      title="忘れ物チェック"
      icon="🎒"
      action={
        <a className="btn ghost small" href={href(`/checklists/${list.id}`)}>
          開く
        </a>
      }
    >
      {data.lists.length > 1 && (
        <div className="chip-row" role="group" aria-label="リストを選ぶ" style={{ marginBottom: 8 }}>
          {data.lists.map((l, i) => (
            <button key={l.id} type="button" className="chip" aria-pressed={l.id === list.id} onClick={() => setIdx(i)}>
              {l.name}
            </button>
          ))}
        </div>
      )}
      <div className="spread small" style={{ marginBottom: 6 }}>
        <span className="muted">{list.name}</span>
        <span className="num" aria-live="polite">
          {done} / {items.length} 確認
        </span>
      </div>
      <ProgressBar value={done} max={items.length} label={`${list.name}の確認状況`} />
      {items.length > 0 && done === items.length ? (
        <p className="banner info" style={{ marginTop: 10, marginBottom: 0 }} role="status">
          <span aria-hidden="true">✅ </span>ぜんぶ確認できました。いってらっしゃい！
        </p>
      ) : (
        <ul className="list" style={{ marginTop: 6 }}>
          {items.map((it) => (
            <li key={it.id}>
              <CheckRow checked={!!it.checked} label={it.label} onToggle={() => void toggleCheckItem(it)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TodayTasksCard({ onAdd }: { onAdd: () => void }) {
  const todayStr = useToday();
  const tasks = useLiveQuery(async () => {
    const all = await getDb().tasks.toArray();
    return all
      .filter((t) => !t.deleted && !t.done && t.dueDate !== null && t.dueDate <= todayStr)
      .sort((a, b) => a.priority - b.priority || a.sortOrder - b.sortOrder);
  }, [todayStr]);
  const doneToday = useLiveQuery(async () => {
    const all = await getDb().tasks.toArray();
    return all.filter((t) => !t.deleted && t.done && t.doneAt && t.doneAt.slice(0, 10) >= addDays(todayStr, -1) && t.dueDate === todayStr).length;
  }, [todayStr]);
  if (!tasks) return null;
  return (
    <Card
      title="今日やること"
      icon="✏️"
      action={
        <a className="btn ghost small" href={href('/tasks')}>
          すべて
        </a>
      }
    >
      {tasks.length === 0 ? (
        <Empty emoji="🌿">
          <p>{doneToday ? '今日の予定はひと段落です。おつかれさまです。' : '今日の予定はまだありません。'}</p>
        </Empty>
      ) : (
        <ul className="list">
          {tasks.slice(0, 5).map((t) => (
            <li key={t.id}>
              <CheckRow
                round
                checked={false}
                label={t.title}
                sub={t.carriedFrom ? `${formatShort(t.carriedFrom)}から繰り越し` : t.priority === 1 ? '優先' : undefined}
                onToggle={() => void setTaskDone(t, true)}
              />
            </li>
          ))}
        </ul>
      )}
      {tasks.length > 5 && <p className="muted small">ほか {tasks.length - 5} 件</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn grow" onClick={onAdd}>
          <Icon name="plus" /> 追加
        </button>
        {tasks.length > 0 && (
          <button type="button" className="btn primary grow" onClick={() => navigate('/focus')}>
            <Icon name="target" /> 1つずつやる
          </button>
        )}
      </div>
    </Card>
  );
}

interface UpcomingItem {
  date: string;
  label: string;
  emoji: string;
}

function UpcomingCard() {
  const todayStr = useToday();
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    const db = getDb();
    return { tasks: await db.tasks.toArray(), fixed: await db.fixedCosts.toArray() };
  }, []);
  if (!data || !settings) return null;
  const end = addDays(todayStr, 8);
  const items: UpcomingItem[] = [];
  if (settings.features.tasks) {
    for (const t of data.tasks) {
      if (!t.deleted && !t.done && t.dueDate && t.dueDate > todayStr && t.dueDate < end) {
        items.push({ date: t.dueDate, label: t.title + (t.dueTime ? `（${t.dueTime}）` : ''), emoji: '✏️' });
      }
    }
  }
  if (settings.features.money) {
    for (const f of data.fixed) {
      if (f.deleted || !f.active) continue;
      for (const d of fixedCostDueDates(f, todayStr, end)) items.push({ date: d, label: `${f.name}の支払い ${formatYen(f.amount)}`, emoji: '📅' });
    }
    if (settings.paydayDay) {
      const p = getPayPeriod(todayStr, settings.paydayDay, settings.paydayWeekendRule);
      if (p.start === todayStr) items.push({ date: todayStr, label: '給料日', emoji: '💴' });
      else if (p.nextPayday < end) items.push({ date: p.nextPayday, label: '給料日', emoji: '💴' });
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : 1));
  return (
    <Card title="これからの予定" icon="📆">
      {items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          1週間以内の予定はありません。
        </p>
      ) : (
        <ul className="list">
          {items.slice(0, 6).map((it, i) => {
            const d = diffDays(todayStr, it.date);
            return (
              <li key={i} className="row" style={{ minHeight: 48 }}>
                <span aria-hidden="true">{it.emoji}</span>
                <span className="grow">{it.label}</span>
                <span className="tag">{d === 0 ? '今日' : d === 1 ? '明日' : formatShort(it.date)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** 体重（設定でオンにしたときだけ表示）。目標や判定は出さず、最新の記録だけを示す */
function WeightCard({ onAdd }: { onAdd: () => void }) {
  const todayStr = useToday();
  const list = useLiveQuery(async () => sortNewestFirst(await getDb().weights.toArray()).slice(0, 2), []);
  if (!list) return null;
  const [latest, prev] = list;
  return (
    <Card
      title="体重"
      icon="⚖️"
      action={
        <a className="btn ghost small" href={href('/weight')}>
          記録を見る
        </a>
      }
    >
      <div data-testid="weight-card">
        {latest ? (
          <p style={{ marginBottom: 4 }}>
            <span className="muted small">{latest.date === todayStr ? '今日' : formatShort(latest.date)}の記録 </span>
            <strong className="num" style={{ fontSize: '1.4rem' }}>
              {formatKg(latest.weightCg)}
            </strong>
            {prev && <span className="muted small"> （前回から {formatDiff(latest.weightCg - prev.weightCg)}）</span>}
          </p>
        ) : (
          <p className="muted">まだ記録はありません。</p>
        )}
        <button type="button" className="btn primary block" onClick={onAdd}>
          <Icon name="plus" /> 今日の体重を記録
        </button>
      </div>
    </Card>
  );
}
