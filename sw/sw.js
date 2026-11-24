/* Life Partner Service Worker
 * - アプリの部品（HTML/JS/CSS/アイコン）をキャッシュし、オフラインでも起動できるようにする
 * - 利用者の記録（IndexedDB）には一切触れない。キャッシュ削除とデータ削除は完全に別
 * - 新しいバージョンは利用者が「更新」を押したときに切り替える（入力中の画面を勝手に再読み込みしない）
 * - Supabase など外部への通信はキャッシュしない
 *
 * バージョンと事前キャッシュ一覧はビルド時に埋め込まれる（vite.config.ts）
 */
const VERSION = '__BUILD_VERSION__';
const CACHE = `lp-shell-${VERSION}`;
const PRECACHE = __PRECACHE__;
const BASE = '__BASE__'; // 公開先のパス（例 '/' や '/seikatusien/'）

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('lp-shell-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') event.source && event.source.postMessage({ type: 'VERSION', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部通信（Supabase等）は素通し
  if (url.pathname === `${BASE}sw.js`) return;

  if (req.mode === 'navigate') {
    // アプリ本体：キャッシュを優先（オフライン・電波が弱い場所でもすぐ開く）
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(`${BASE}index.html`);
        if (cached) return cached;
        try {
          return await fetch(req);
        } catch {
          return new Response('<!doctype html><meta charset="utf-8"><title>オフライン</title><p style="font-family:sans-serif;padding:24px">オフラインのため読み込めませんでした。通信できる場所でもう一度開いてください。</p>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok && (url.pathname.startsWith(`${BASE}assets/`) || url.pathname.startsWith(`${BASE}icons/`))) {
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return cached || Response.error();
      }
    })(),
  );
});

// ---------- Web Push（サーバー側の設定が必要。未検証） ----------
self.addEventListener('push', (event) => {
  let data = { title: 'Life Partner', body: '' };
  try {
    data = Object.assign(data, event.data ? event.data.json() : {});
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: `${BASE}icons/icon-192.png`,
      badge: `${BASE}icons/icon-192.png`,
      tag: data.tag,
      data: { url: data.url || BASE },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || BASE;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
