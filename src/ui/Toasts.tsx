import { useEffect, useState } from 'react';
import { subscribe } from '../lib/events';

interface T {
  id: number;
  message: string;
  error?: boolean;
  undo?: () => void | Promise<void>;
}

let nextId = 1;

/** 操作結果の表示と「元に戻す」。保存失敗は目立つ色で長めに表示する。 */
export function Toasts() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type !== 'toast' && e.type !== 'save-error') return;
        const t: T = e.type === 'toast' ? { id: nextId++, message: e.message, undo: e.undo } : { id: nextId++, message: e.message, error: true };
        setItems((xs) => [...xs.filter((x) => x.message !== t.message).slice(-2), t]);
        const ms = t.error ? 10_000 : t.undo ? 6_000 : 3_000;
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), ms);
      }),
    [],
  );
  return (
    <div className="toasts" aria-live="polite" role="status">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.error ? 'error' : ''}`} role={t.error ? 'alert' : undefined}>
          <span className="grow">{t.message}</span>
          {t.undo && (
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                setItems((xs) => xs.filter((x) => x.id !== t.id));
                await t.undo?.();
              }}
            >
              元に戻す
            </button>
          )}
          {!t.undo && (
            <button type="button" className="btn small" aria-label="閉じる" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
              OK
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
