// アイコンPNGの生成（SVG → PNG）。ローカルの Chromium/Playwright を使用。
// 使い方: node scripts/make-icons.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const exe = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const out = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['apple-touch-icon.png', 180, 1],
  ['maskable-512.png', 512, 0.8],
];
for (const [name, size, scale] of out) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * scale);
  await page.setContent(`<html><body style="margin:0;background:#3f7a6b;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: false });
}
await browser.close();
console.log('icons generated');
