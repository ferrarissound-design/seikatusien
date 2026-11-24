import { useSyncExternalStore } from 'react';

/**
 * ハッシュベースの最小ルーター。
 * PWA をホーム画面から起動したときに URL が変わっても確実に動作し、
 * Vercel 側のリライト設定に依存しない。
 */
export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const h = typeof location !== 'undefined' ? location.hash.replace(/^#\/?/, '') : '';
  const [p, q = ''] = h.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

let current = parse();
const ls = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse();
    ls.forEach((l) => l());
    window.scrollTo(0, 0);
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => current,
  );
}

export function navigate(to: string, replace = false) {
  const h = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (replace) {
    history.replaceState(null, '', h);
    current = parse();
    ls.forEach((l) => l());
  } else {
    location.hash = h;
  }
}

export const href = (to: string) => `#${to.startsWith('/') ? to : `/${to}`}`;
