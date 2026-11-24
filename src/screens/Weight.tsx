import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/db';
import { PageHead, Card, Sheet, Empty, Segmented } from '../ui/components';
import { Icon } from '../ui/Icon';
import { useToday } from '../ui/hooks';
import { addWeight, deleteWithUndo } from '../db/actions';
import { updateRecord } from '../db/repo';
import type { WeightEntry } from '../db/types';
import { parseKg, formatKg, formatDiff, kgText, dailySeries, sortNewestFirst, weightsToCsv, type DailyPoint } from '../lib/weight';
import { formatShort, isValidDateStr, isValidTime, today } from '../lib/date';
import { shareOrDownload } from '../backup/backup';
import { toast } from '../lib/events';

/**
 * 体重の記録（健康管理を自分で行うため）。
 * 目標・BMI・良し悪しの判定は行わない。増減は矢印と文字だけで示し、色で評価しない。
 */
export function WeightScreen() {
  const todayStr = useToday();
  const list = useLiveQuery(async () => sortNewestFirst(await getDb().weights.toArray()), []);
  const [range, setRange] = useState<30 | 90>(30);
  const [editing, setEditing] = useState<WeightEntry | 'new' | null>(null);
  if (!list) return null;
  const series = dailySeries(list, todayStr, range);

  return (
    <main>
      <PageHead title="体重" back="/home" />
      <button type="button" className="btn primary block" onClick={() => setEditing('new')}>
        <Icon name="plus" /> 体重を記録
      </button>

      <Card title="推移">
        <Segmented
          label="期間"
          value={range}
          onChange={setRange}
          options={[
            { value: 30, label: '30日' },
            { value: 90, label: '90日' },
          ]}
        />
        {series.length === 0 ? (
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            この期間の記録はありません。
          </p>
        ) : (
          <WeightChart points={series} />
        )}
      </Card>

      <Card title="記録">
        {list.length === 0 ? (
          <Empty emoji="📝">まだ記録はありません。</Empty>
        ) : (
          <ul className="list">
            {list.slice(0, 200).map((w, i) => {
              const prev = list[i + 1];
              return (
                <li key={w.id}>
                  <button type="button" className="check-row" onClick={() => setEditing(w)} aria-label={`${formatShort(w.date)} ${formatKg(w.weightCg)} を編集`}>
                    <span className="label-text">
                      <span className="num" style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                        {formatKg(w.weightCg)}
                      </span>
                      {prev && <span className="muted small"> （前回から {formatDiff(w.weightCg - prev.weightCg)}）</span>}
                      <span className="muted small" style={{ display: 'block' }}>
                        {formatShort(w.date)}
                        {w.time && ` ${w.time}`}
                        {w.memo && ` ・ ${w.memo}`}
                      </span>
                    </span>
                    <Icon name="edit" size={20} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {list.length > 0 && (
        <button
          type="button"
          className="btn block"
          style={{ marginTop: 12 }}
          onClick={() => void shareOrDownload(`lifepartner-weight-${today()}.csv`, weightsToCsv(list), 'text/csv')}
        >
          <Icon name="download" size={20} /> 体重の記録をCSVで書き出す
        </button>
      )}

      {editing && <WeightSheet entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

/** 体重の入力シート（ホームからも使う） */
export function WeightSheet({ entry, onClose }: { entry: WeightEntry | null; onClose: () => void }) {
  const [value, setValue] = useState(entry ? kgText(entry.weightCg) : '');
  const [date, setDate] = useState(entry?.date ?? today());
  const [time, setTime] = useState(entry?.time ?? '');
  const [memo, setMemo] = useState(entry?.memo ?? '');
  const [busy, setBusy] = useState(false);
  const cg = parseKg(value);
  const invalid = value !== '' && cg === null;
  const futureDate = isValidDateStr(date) && date > today();
  const valid = cg !== null && isValidDateStr(date) && !futureDate && (time === '' || isValidTime(time));

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (entry) {
        await updateRecord<WeightEntry>('weights', entry.id, { weightCg: cg!, date, time: time || null, memo: memo.trim().slice(0, 1000) });
      } else {
        const rec = await addWeight({ weightCg: cg!, date, ...(entry === null && time ? { time } : {}), memo });
        toast(`体重 ${formatKg(rec.weightCg)} を記録しました`, () => deleteWithUndo('weights', rec.id, '体重の記録'));
      }
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={entry ? '体重の記録を編集' : '体重を記録'}
      onClose={onClose}
      actions={
        <>
          {entry && (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                void deleteWithUndo('weights', entry.id, '体重の記録');
                onClose();
              }}
            >
              <Icon name="trash" size={20} /> 削除
            </button>
          )}
          <button type="button" className="btn primary" disabled={!valid || busy} onClick={() => void save()}>
            {entry ? '保存' : '記録する'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>体重（kg・小数第2位まで）</span>
        <div className="input-unit">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="例：65.45"
            value={value}
            data-autofocus="true"
            aria-invalid={invalid}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
          <span aria-hidden="true">kg</span>
        </div>
        {invalid && <div className="error-text">「65.45」のように、小数第2位までの数字で入力してください</div>}
      </label>
      <details className="disclosure" open={!!entry}>
        <summary>日付・時刻・メモ（任意）</summary>
        <label className="field">
          <span>日付</span>
          <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          {futureDate && <div className="error-text">今日より後の日付は選べません</div>}
        </label>
        <label className="field">
          <span>時刻（空欄なら記録した時刻）</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="field">
          <span>メモ</span>
          <input type="text" value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} placeholder="例：朝ごはんの前" />
        </label>
      </details>
    </Sheet>
  );
}

/**
 * 推移のグラフ（1系列の折れ線）。
 * 色だけに頼らないよう、点を押すと値を文字で表示し、下に同じ内容の表を置く。
 * 縦軸は記録の範囲に合わせる（0 から始めないのは、体重の小さな変化を読み取るため）。
 */
function WeightChart({ points }: { points: DailyPoint[] }) {
  const [selected, setSelected] = useState<number>(points.length - 1);
  const W = 320;
  const H = 160;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const values = points.map((p) => p.weightCg);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 100) {
    const mid = (max + min) / 2;
    min = mid - 50;
    max = mid + 50;
  }
  const x = (i: number) => (points.length === 1 ? (padL + W - padR) / 2 : padL + (i * (W - padL - padR)) / (points.length - 1));
  const y = (v: number) => padT + ((max - v) * (H - padT - padB)) / (max - min);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.weightCg).toFixed(1)}`).join(' ');
  const sel = points[Math.min(selected, points.length - 1)];
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div style={{ marginTop: 12 }}>
      <p className="weight-chart-readout" aria-live="polite">
        <span className="num">{formatShort(sel.date)}</span> <strong className="num">{formatKg(sel.weightCg)}</strong>
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="weight-chart"
        role="img"
        aria-label={`体重の推移。${formatShort(first.date)} ${formatKg(first.weightCg)} から ${formatShort(last.date)} ${formatKg(last.weightCg)}。くわしい値は下の表にあります。`}
      >
        {[max, (max + min) / 2, min].map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="weight-grid" />
            <text x={padL - 6} y={y(v) + 4} textAnchor="end" className="weight-axis">
              {kgText(Math.round(v))}
            </text>
          </g>
        ))}
        <text x={padL} y={H - 6} className="weight-axis">
          {formatShort(first.date).replace(/（.）/, '')}
        </text>
        {points.length > 1 && (
          <text x={W - padR} y={H - 6} textAnchor="end" className="weight-axis">
            {formatShort(last.date).replace(/（.）/, '')}
          </text>
        )}
        <path d={path} className="weight-line" />
        {points.map((p, i) => (
          <g key={p.date}>
            <circle cx={x(i)} cy={y(p.weightCg)} r={i === selected ? 6 : 4} className={i === selected ? 'weight-dot selected' : 'weight-dot'} />
          </g>
        ))}
        {/* 押しやすいよう、点より大きい当たり判定 */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.date}`}
            x={x(i) - Math.max(8, (W - padL - padR) / Math.max(1, points.length - 1) / 2)}
            y={0}
            width={Math.max(16, (W - padL - padR) / Math.max(1, points.length - 1))}
            height={H}
            fill="transparent"
            onClick={() => setSelected(i)}
            onPointerEnter={() => setSelected(i)}
          />
        ))}
      </svg>
      <details className="disclosure">
        <summary>表で見る</summary>
        <table className="weight-table">
          <thead>
            <tr>
              <th scope="col">日付</th>
              <th scope="col">体重</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.date}>
                <td>{formatShort(p.date)}</td>
                <td className="num">{formatKg(p.weightCg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ margin: 0 }}>1日に複数回記録した日は、その日の最後の記録を表示しています。</p>
      </details>
    </div>
  );
}
