import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/db';
import { PageHead, Card, CheckRow, ProgressBar, Sheet, Empty, AddInline, Segmented, Confirm } from '../ui/components';
import { Icon } from '../ui/Icon';
import { href, navigate, useRoute } from '../ui/router';
import { useSettings, useToday } from '../ui/hooks';
import { createTask, setTaskDone, postponeTask, addSubtask, activeSubtasks, reorder, deleteWithUndo } from '../db/actions';
import { updateRecord } from '../db/repo';
import type { Task, Subtask, Priority, Recurrence } from '../db/types';
import { addDays, formatShort, WEEKDAY_JA, isValidDateStr, isValidTime, type DateStr } from '../lib/date';
import { describeRecurrence } from '../lib/recurrence';

const PRIORITY_LABEL: Record<Priority, string> = { 1: '高', 2: '中', 3: '低' };

export function TasksScreen() {
  const route = useRoute();
  if (route.path[1]) return <TaskDetail id={route.path[1]} />;
  return <TaskList />;
}

function TaskList() {
  const todayStr = useToday();
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const [creating, setCreating] = useState(false);
  const [cat, setCat] = useState<string>('');
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    const db = getDb();
    const tasks = (await db.tasks.toArray()).filter((t) => !t.deleted);
    const subs = (await db.subtasks.toArray()).filter((s) => !s.deleted);
    return { tasks, subs };
  }, []);
  if (!data || !settings) return null;
  const filtered = data.tasks.filter((t) => !cat || t.category === cat);
  const active = filtered.filter((t) => !t.done).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.priority - b.priority || a.sortOrder - b.sortOrder);
  const todayTasks = active.filter((t) => t.dueDate && t.dueDate <= todayStr);
  const later = active.filter((t) => t.dueDate && t.dueDate > todayStr);
  const noDate = active.filter((t) => !t.dueDate);
  const done = filtered.filter((t) => t.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')).slice(0, 100);
  const subInfo = (id: string) => {
    const s = data.subs.filter((x) => x.taskId === id);
    return s.length ? `${s.filter((x) => x.done).length}/${s.length} ステップ` : '';
  };

  const row = (t: Task) => (
    <li key={t.id} className="row">
      <div className="grow">
        <CheckRow
          round
          checked={!!t.done}
          label={t.title}
          onToggle={() => void setTaskDone(t, !t.done)}
          sub={[
            t.dueDate && t.dueDate !== todayStr ? formatShort(t.dueDate) : '',
            t.dueTime ?? '',
            t.carriedFrom && !t.done ? `${formatShort(t.carriedFrom)}から繰り越し` : '',
            describeRecurrence(t.recurrence),
            subInfo(t.id),
            t.priority === 1 ? '優先' : '',
            t.category,
          ]
            .filter(Boolean)
            .join(' ・ ') || undefined}
        />
      </div>
      <a className="icon-btn" href={href(`/tasks/${t.id}`)} aria-label={`${t.title}の詳細`}>
        <Icon name="chev" />
      </a>
    </li>
  );

  return (
    <main>
      <PageHead
        title="タスク"
        right={
          <a className="btn ghost small" href={href('/focus')}>
            <Icon name="target" size={20} /> 集中
          </a>
        }
      />
      <Segmented
        label="表示"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: `これから（${active.length}）` },
          { value: 'done', label: '完了したこと' },
        ]}
      />
      <div className="chip-row" style={{ margin: '12px 0' }} role="group" aria-label="カテゴリーで絞り込み">
        <button type="button" className="chip" aria-pressed={cat === ''} onClick={() => setCat('')}>
          すべて
        </button>
        {settings.taskCategories.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>

      {tab === 'active' ? (
        <>
          {active.length === 0 && (
            <Card>
              <Empty emoji="🌿">
                <p>いまのところ、やることはありません。</p>
              </Empty>
            </Card>
          )}
          {todayTasks.length > 0 && (
            <Card title="今日">
              <ul className="list">{todayTasks.map(row)}</ul>
            </Card>
          )}
          {later.length > 0 && (
            <Card title="これから">
              <ul className="list">{later.map(row)}</ul>
            </Card>
          )}
          {noDate.length > 0 && (
            <Card title="いつでも">
              <ul className="list">{noDate.map(row)}</ul>
            </Card>
          )}
        </>
      ) : (
        <Card title="完了したこと">
          {done.length === 0 ? <p className="muted">完了したタスクがここに残ります。</p> : <ul className="list">{done.map(row)}</ul>}
        </Card>
      )}
      <button type="button" className="btn primary fab" onClick={() => setCreating(true)}>
        <Icon name="plus" /> 追加
      </button>
      {creating && <TaskSheet onClose={() => setCreating(false)} defaultDue={todayStr} />}
    </main>
  );
}

export function TaskSheet({ task, onClose, defaultDue }: { task?: Task; onClose: () => void; defaultDue?: DateStr | null }) {
  const settings = useSettings();
  const todayStr = useToday();
  const [title, setTitle] = useState(task?.title ?? '');
  const [due, setDue] = useState<DateStr | null>(task ? task.dueDate : defaultDue ?? null);
  const [time, setTime] = useState(task?.dueTime ?? '');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 2);
  const [category, setCategory] = useState(task?.category ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [rec, setRec] = useState<Recurrence>(task?.recurrence ?? { kind: 'none' });
  const [steps, setSteps] = useState('');
  const tomorrow = addDays(todayStr, 1);

  const save = async () => {
    const t = title.trim().slice(0, 500);
    if (!t) return;
    const data = {
      title: t,
      dueDate: due && isValidDateStr(due) ? due : rec.kind !== 'none' ? todayStr : null,
      dueTime: time && isValidTime(time) ? time : null,
      priority,
      category,
      notes: notes.slice(0, 5000),
      recurrence: rec,
    };
    if (task) {
      await updateRecord<Task>('tasks', task.id, data);
    } else {
      const created = await createTask(data);
      for (const s of steps.split('\n').map((x) => x.trim()).filter(Boolean)) await addSubtask(created.id, s);
    }
    onClose();
  };

  const dueChoice = due === null ? 'none' : due === todayStr ? 'today' : due === tomorrow ? 'tomorrow' : 'custom';

  return (
    <Sheet
      title={task ? 'タスクを編集' : 'タスクを追加'}
      onClose={onClose}
      actions={
        <button type="button" className="btn primary" onClick={() => void save()} disabled={!title.trim()}>
          {task ? '保存' : '追加'}
        </button>
      }
    >
      <label className="field">
        <span>やること</span>
        <input type="text" value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} placeholder="例：部屋を掃除する" data-autofocus="true" enterKeyHint="done" />
      </label>
      <div className="field">
        <span className="muted small" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
          いつやる？
        </span>
        <Segmented
          label="期限"
          value={dueChoice}
          onChange={(v) => setDue(v === 'none' ? null : v === 'today' ? todayStr : v === 'tomorrow' ? tomorrow : due ?? addDays(todayStr, 2))}
          options={[
            { value: 'today', label: '今日' },
            { value: 'tomorrow', label: '明日' },
            { value: 'custom', label: '日付' },
            { value: 'none', label: 'いつでも' },
          ]}
        />
        {dueChoice === 'custom' && (
          <input type="date" style={{ marginTop: 8 }} value={due ?? ''} onChange={(e) => e.target.value && setDue(e.target.value)} aria-label="期限の日付" />
        )}
      </div>
      {!task && (
        <label className="field">
          <span>小さなステップに分ける（任意・1行に1つ）</span>
          <textarea value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'例：\nゴミを集める\nゴミを捨てる\n掃除機をかける'} />
        </label>
      )}
      <details className="disclosure" open={!!task}>
        <summary>くわしい設定（任意）</summary>
        <label className="field">
          <span>時刻</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <div className="field">
          <span className="muted small" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
            優先度
          </span>
          <Segmented<Priority>
            label="優先度"
            value={priority}
            onChange={setPriority}
            options={[1, 2, 3].map((p) => ({ value: p as Priority, label: PRIORITY_LABEL[p as Priority] }))}
          />
        </div>
        <label className="field">
          <span>カテゴリー</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">なし</option>
            {settings?.taskCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <RecurrenceEditor value={rec} onChange={setRec} />
        <label className="field">
          <span>メモ</span>
          <textarea value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </details>
    </Sheet>
  );
}

function RecurrenceEditor({ value, onChange }: { value: Recurrence; onChange: (r: Recurrence) => void }) {
  return (
    <div className="field">
      <span className="muted small" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
        くり返し
      </span>
      <select
        value={value.kind}
        onChange={(e) => {
          const k = e.target.value as Recurrence['kind'];
          onChange(k === 'weekly' ? { kind: 'weekly', weekdays: [] } : k === 'monthly' ? { kind: 'monthly', day: 1 } : ({ kind: k } as Recurrence));
        }}
        aria-label="くり返し"
      >
        <option value="none">くり返さない</option>
        <option value="daily">毎日</option>
        <option value="weekly">毎週</option>
        <option value="monthly">毎月</option>
      </select>
      {value.kind === 'weekly' && (
        <div className="row wrap" style={{ marginTop: 8 }} role="group" aria-label="曜日">
          {WEEKDAY_JA.map((w, i) => (
            <button
              key={w}
              type="button"
              className="chip"
              aria-pressed={value.weekdays.includes(i)}
              onClick={() => onChange({ kind: 'weekly', weekdays: value.weekdays.includes(i) ? value.weekdays.filter((x) => x !== i) : [...value.weekdays, i] })}
            >
              {w}
            </button>
          ))}
        </div>
      )}
      {value.kind === 'monthly' && (
        <select style={{ marginTop: 8 }} value={value.day} onChange={(e) => onChange({ kind: 'monthly', day: Number(e.target.value) })} aria-label="日">
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              毎月{d}日{d >= 29 ? '（ない月は月末）' : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** よくある作業の分解例（押すとステップとして追加） */
const BREAKDOWN_HINTS: { match: RegExp; steps: string[] }[] = [
  { match: /掃除|片付/, steps: ['ゴミを集める', 'ゴミを捨てる', '洗濯物をまとめる', '掃除機をかける', '机の上を片付ける'] },
  { match: /洗濯/, steps: ['洗濯物を集める', '洗濯機を回す', '干す', '取り込む', 'たたんでしまう'] },
  { match: /書類|申請|手続/, steps: ['必要なものを調べる', '書類をそろえる', '記入する', '提出する'] },
  { match: /買い物|買う/, steps: ['買うものをメモする', '財布とエコバッグを持つ', 'お店に行く', '買ったものをしまう'] },
];

function TaskDetail({ id }: { id: string }) {
  const todayStr = useToday();
  const data = useLiveQuery(async () => {
    const db = getDb();
    const task = await db.tasks.get(id);
    const subs = await activeSubtasks(id);
    return { task, subs };
  }, [id]);
  const [editing, setEditing] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  if (!data) return null;
  const { task, subs } = data;
  if (!task || task.deleted) {
    return (
      <main>
        <PageHead title="タスク" back="/tasks" />
        <Empty emoji="🔍">このタスクは見つかりませんでした。</Empty>
      </main>
    );
  }
  const doneCount = subs.filter((s) => s.done).length;
  const hint = BREAKDOWN_HINTS.find((h) => h.match.test(task.title));
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= subs.length) return;
    const ids = subs.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorder('subtasks', ids);
  };
  return (
    <main>
      <PageHead
        title="タスク"
        back="/tasks"
        right={
          <button type="button" className="icon-btn" aria-label="編集" onClick={() => setEditing(true)}>
            <Icon name="edit" />
          </button>
        }
      />
      <Card>
        <h2 style={{ fontSize: '1.35rem', overflowWrap: 'anywhere' }}>{task.title}</h2>
        <div className="row wrap" style={{ marginBottom: 8 }}>
          {task.dueDate && <span className="tag">{task.dueDate === todayStr ? '今日' : formatShort(task.dueDate)}{task.dueTime ? ` ${task.dueTime}` : ''}</span>}
          {task.priority === 1 && <span className="tag accent">優先</span>}
          {task.category && <span className="tag">{task.category}</span>}
          {task.recurrence.kind !== 'none' && <span className="tag primary">🔁 {describeRecurrence(task.recurrence)}</span>}
          {task.carriedFrom && !task.done && <span className="tag">{formatShort(task.carriedFrom)}から繰り越し</span>}
          {task.done ? <span className="tag primary">✅ 完了</span> : null}
        </div>
        {task.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{task.notes}</p>}
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button type="button" className="btn primary grow" onClick={() => void setTaskDone(task, !task.done)}>
            <Icon name="check" /> {task.done ? '未完了に戻す' : '完了にする'}
          </button>
          {!task.done && (
            <>
              <button type="button" className="btn grow" onClick={() => void postponeTask(task)}>
                明日に回す
              </button>
              <button type="button" className="btn grow" onClick={() => navigate(`/focus?task=${task.id}`)}>
                <Icon name="target" size={20} /> 集中して取り組む
              </button>
            </>
          )}
        </div>
      </Card>

      <Card
        title="小さなステップ"
        action={
          subs.length > 1 && (
            <button type="button" className="btn ghost small" onClick={() => setSorting((s) => !s)} aria-pressed={sorting}>
              <Icon name="sort" size={18} /> {sorting ? '終了' : '並び替え'}
            </button>
          )
        }
      >
        {subs.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div className="spread small muted">
              <span>進み具合</span>
              <span className="num">
                {doneCount} / {subs.length}
              </span>
            </div>
            <ProgressBar value={doneCount} max={subs.length} label="ステップの進み具合" />
          </div>
        )}
        {subs.length === 0 && <p className="muted small">大きなタスクは、すぐ終わる小さな作業に分けると取りかかりやすくなります。</p>}
        <ul className="list">
          {subs.map((s, i) => (
            <li key={s.id} className="row">
              <div className="grow">
                <CheckRow checked={!!s.done} label={s.title} onToggle={() => void updateRecord<Subtask>('subtasks', s.id, { done: s.done ? 0 : 1 })} />
              </div>
              {sorting ? (
                <>
                  <button type="button" className="icon-btn" aria-label={`${s.title}を上へ`} disabled={i === 0} onClick={() => void move(i, -1)}>
                    <Icon name="up" />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`${s.title}を下へ`} disabled={i === subs.length - 1} onClick={() => void move(i, 1)}>
                    <Icon name="down" />
                  </button>
                </>
              ) : (
                <button type="button" className="icon-btn" aria-label={`${s.title}を削除`} onClick={() => void deleteWithUndo('subtasks', s.id, `「${s.title}」`)}>
                  <Icon name="trash" size={20} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 12 }}>
          <AddInline label="ステップを追加" placeholder="ステップを追加" onAdd={(v) => addSubtask(task.id, v)} />
        </div>
        {hint && subs.length === 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="muted small">分け方の例（押すと追加）</p>
            <div className="row wrap">
              {hint.steps.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => void addSubtask(task.id, s)}>
                  ＋ {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <button type="button" className="btn danger block" style={{ marginTop: 16 }} onClick={() => setConfirmDel(true)}>
        <Icon name="trash" size={20} /> このタスクを削除
      </button>

      {editing && <TaskSheet task={task} onClose={() => setEditing(false)} />}
      {confirmDel && (
        <Confirm
          title="タスクを削除しますか？"
          message={<p>「{task.title}」を削除します。削除直後なら「元に戻す」で戻せます。</p>}
          confirmLabel="削除する"
          danger
          onCancel={() => setConfirmDel(false)}
          onConfirm={() => {
            void deleteWithUndo('tasks', task.id, 'タスク');
            navigate('/tasks', true);
          }}
        />
      )}
    </main>
  );
}
