import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { openInitialDb, startSync } from './sync/manager';
import { startDailyMaintenance } from './db/daily';
import { registerServiceWorker, requestPersistentStorage, trackKeyboard } from './pwa';
import { emit } from './lib/events';

async function boot() {
  const db = openInitialDb();
  try {
    await db.open();
  } catch (e) {
    // IndexedDB が使えない（プライベートブラウズ・容量不足など）
    const root = document.getElementById('root')!;
    root.innerHTML =
      '<div style="font-family:sans-serif;padding:24px;line-height:1.7"><h1 style="font-size:1.3rem">データを保存できない状態です</h1><p>この端末のブラウザがデータの保存を許可していないか、空き容量が不足しています。プライベートブラウズを使っている場合は、通常のモードで開いてください。</p></div>';
    console.error('IndexedDB open failed', (e as Error)?.name);
    return;
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  registerServiceWorker();
  trackKeyboard();
  void requestPersistentStorage();
  void startSync().catch(() => emit({ type: 'toast', message: 'クラウドに接続できませんでした。端末には保存されています。' }));
  startDailyMaintenance();
}

void boot();
