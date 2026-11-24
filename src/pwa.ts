import { createStore } from './lib/store';

/** Service Worker の登録と、更新の通知 */
export const pwaState = createStore<{ updateReady: boolean }>({ updateReady: false });

let waiting: ServiceWorker | null = null;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = w;
            pwaState.set({ updateReady: true });
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        waiting = reg.waiting;
        pwaState.set({ updateReady: true });
      }
      reg.addEventListener('updatefound', () => track(reg.installing));
      // ホーム画面アプリは長時間開きっぱなしになりがちなので、表示のたびに更新を確認
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
      });
    } catch {
      /* 登録できなくてもアプリは動く（オフライン起動のみ不可） */
    }
  };
  // DBの準備を待ってから呼ばれるため、load イベントが既に終わっている場合がある
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register());
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return;
    reloading = true;
    location.reload();
  });
}

/** 利用者が「更新」を押したときに新しいバージョンへ切り替える（データは IndexedDB にあり影響しない） */
export function applyUpdate() {
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  else location.reload();
}

/**
 * アプリのキャッシュ（HTML/JS/CSS）だけを削除して読み込み直す。
 * 利用者の記録（IndexedDB / localStorage）には触れない。
 */
export async function clearAppCache() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('lp-shell-')).map((k) => caches.delete(k)));
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
  } finally {
    location.reload();
  }
}

export interface StorageInfo {
  persisted: boolean;
  usage?: number;
  quota?: number;
}

/** ブラウザにデータの永続保存を依頼（容量不足時に自動削除されにくくする） */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageInfo(): Promise<StorageInfo> {
  try {
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    return { persisted, usage: est?.usage, quota: est?.quota };
  } catch {
    return { persisted: false };
  }
}

/**
 * iOS でキーボードが表示されたとき、見えている領域（visualViewport）に合わせて
 * 下からのシートを持ち上げる。CSS 変数 --kb に「キーボードで隠れている高さ」を入れる。
 */
export function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(hidden)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
