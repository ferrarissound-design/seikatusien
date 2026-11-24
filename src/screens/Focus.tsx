import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/db';
import { ProgressBar, Empty } from '../ui/components';
import { Icon } from '../ui/Icon';
import { href, navigate, useRoute } from '../ui/router';
import { useToday } from '../ui/hooks';
import { setTaskDone } from '../db/actions';
import { updateRecord } from '../db/repo';
import type { Subtask } from '../db/types';

/**
 * 集中モード：いま取り組むタスクを1つだけ大きく表示する。
 * 他のタスクやナビゲーションは表示しない。急かす演出（タイマー・連続記録）は入れない。
 */
export function FocusScreen() {
  const route = useRoute();
  const todayStr = useToday();
  const pinned = route.query.get('task');
  const [skipped, setSkipped] = useState<string[]>([]);
  const data = useLiveQuery(async () => {
    const db = getDb();
    const tasks = (await db.tasks.toArray())
      .filter((t) => !t.deleted && !t.done)
      .sort((a, b) => {
        const ad = a.dueDate && a.dueDate <= todayStr ? 0 : a.dueDate ? 1 : 2;
        const bd = b.dueDate && b.dueDate <= todayStr ? 0 : b.dueDate ? 1 : 2;
        return ad - bd || a.priority - b.priority || (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.sortOrder - b.sortOrder;
      });
    const subs = (await db.subtasks.toArray()).filter((s) => !s.deleted);
    return { tasks, subs };
  }, [todayStr]);
  if (!data) return null;

  const candidates = data.tasks.filter((t) => !skipped.includes(t.id));
  const task = (pinned && data.tasks.find((t) => t.id === pinned)) || candidates[0];
  const exit = (
    <a className="btn ghost" href={href('/tasks')}>
      <Icon name="close" size={20} /> 集中モードを終わる
    </a>
  );

  if (!task) {
    return (
      <div className="focus-wrap">
        <div className="spread">{exit}</div>
        <div style={{ margin: 'auto 0' }}>
          <Empty emoji="🌿">
            <p style={{ fontSize: '1.2rem' }}>{data.tasks.length ? 'ほかのタスクは「あとで」にしました。' : '取り組むタスクはありません。'}</p>
            <p>ひと休みしましょう。</p>
            {skipped.length > 0 && (
              <button type="button" className="btn" onClick={() => setSkipped([])}>
                最初から見る
              </button>
            )}
          </Empty>
        </div>
      </div>
    );
  }

  const subs = data.subs.filter((s) => s.taskId === task.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const current = subs.find((s) => !s.done);
  const doneCount = subs.filter((s) => s.done).length;

  const next = () => {
    if (pinned) navigate('/focus', true);
    setSkipped((s) => [...s, task.id]);
  };

  return (
    <div className="focus-wrap">
      <div className="spread">{exit}</div>
      <div style={{ margin: 'auto 0', padding: '24px 0' }}>
        <p className="muted" style={{ marginBottom: 0 }}>
          いま取り組むこと
        </p>
        <div className="focus-title" aria-live="polite">
          {task.title}
        </div>
        {subs.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            {current ? (
              <>
                <p className="muted small" style={{ marginBottom: 4 }}>
                  次のステップ（{doneCount + 1} / {subs.length}）
                </p>
                <p style={{ fontSize: '1.4rem', fontWeight: 700, overflowWrap: 'anywhere' }}>{current.title}</p>
                <button type="button" className="btn primary block" onClick={() => void updateRecord<Subtask>('subtasks', current.id, { done: 1 })}>
                  <Icon name="check" /> このステップができた
                </button>
              </>
            ) : (
              <p style={{ fontWeight: 700 }}>
                <span aria-hidden="true">✅ </span>すべてのステップができました
              </p>
            )}
            <div style={{ marginTop: 12 }}>
              <ProgressBar value={doneCount} max={subs.length} label="ステップの進み具合" />
            </div>
          </div>
        )}
        {task.notes && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{task.notes}</p>}
      </div>
      <div className="stack" style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
        <button
          type="button"
          className={`btn block ${current ? '' : 'primary'}`}
          style={{ minHeight: 60, fontSize: '1.1rem' }}
          onClick={() => {
            void setTaskDone(task, true);
            if (pinned) navigate('/focus', true);
          }}
        >
          <Icon name="check" /> タスクを完了にする
        </button>
        <button type="button" className="btn block ghost" onClick={next}>
          あとで取り組む（次のタスクへ）
        </button>
      </div>
    </div>
  );
}
