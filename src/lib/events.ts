/** アプリ内の軽量イベントバス（保存失敗・トースト通知など） */
export type AppEvent =
  | { type: 'save-error'; message: string }
  | { type: 'toast'; message: string; undo?: () => void | Promise<void> }
  | { type: 'local-change' };

type Listener = (e: AppEvent) => void;
const listeners = new Set<Listener>();

export function emit(e: AppEvent) {
  listeners.forEach((l) => {
    try {
      l(e);
    } catch {
      /* noop */
    }
  });
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function toast(message: string, undo?: () => void | Promise<void>) {
  emit({ type: 'toast', message, undo });
}
