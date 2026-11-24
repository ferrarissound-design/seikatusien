import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };
const buildVersion = `${pkg.version}-${Date.now().toString(36)}`;

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
      const statics = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/maskable-512.png'];
      const precache = Array.from(new Set([...statics, ...files.map((f) => `/${f}`)])).filter((f) => f !== '/');
      const src = readFileSync(resolve(import.meta.dirname, 'sw/sw.js'), 'utf8')
        .replaceAll('__BUILD_VERSION__', buildVersion)
        .replaceAll('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
