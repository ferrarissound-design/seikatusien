import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };
const buildVersion = `${pkg.version}-${Date.now().toString(36)}`;

/**
 * 公開先のパス。Vercel などドメイン直下なら '/'、
 * GitHub Pages（https://<user>.github.io/<repo>/）なら '/<repo>/'。
 * 環境変数 BASE_PATH で指定する（未指定は '/'）。
 */
const rawBase = process.env.BASE_PATH || '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

/** 本番 CSP（ヘッダーを設定できない GitHub Pages 向けに <meta> でも付与。frame-ancestors は meta では無効なので除外） */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";

function cspMetaPlugin(): Plugin {
  return {
    name: 'lp-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

/**
 * Service Worker を生成する小さなプラグイン。
 * ビルド結果のファイル一覧を事前キャッシュ対象として sw.js に埋め込む。
 * （外部ライブラリに依存せず、キャッシュ対象を明確に管理するため自作）
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'lp-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js');
      const statics = ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png', 'icons/brand-heart.svg'];
      const precache = Array.from(new Set([...statics, ...files])).map((f) => `${base}${f}`);
      const src = readFileSync(resolve(import.meta.dirname, 'sw/sw.js'), 'utf8')
        .replaceAll('__BUILD_VERSION__', buildVersion)
        .replaceAll('__PRECACHE__', JSON.stringify(precache))
        .replaceAll('__BASE__', base);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), serviceWorkerPlugin(), cspMetaPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
