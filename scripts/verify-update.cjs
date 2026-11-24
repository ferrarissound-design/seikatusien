// アプリ更新の検証：旧版で記録 → 新版をビルド → 「更新」→ 記録が残り、古いキャッシュが消えることを確認
// 使い方: npm run build && npm run preview（別ターミナル） → node scripts/verify-update.cjs
const { chromium } = require('playwright');
const { execSync } = require('child_process');
(async () => {
  const b = await chromium.launch(require('fs').existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const p = await (await b.newContext()).newPage();
  await p.goto('http://localhost:4173/');
  await p.getByRole('button', { name: '設定をスキップして始める' }).click();
  await p.getByText('今日は').waitFor();
  await p.getByRole('button', { name: 'タスク追加' }).click();
  await p.getByLabel('やること').fill('更新前のタスク');
  await p.getByRole('dialog').getByRole('button', { name: '追加' }).click();
  await p.getByRole('dialog').waitFor({ state: 'detached' });
  await p.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active);
  await p.reload(); await p.getByText('今日は').waitFor();
  const v1 = await p.evaluate(() => caches.keys());
  execSync('npx vite build', { cwd: require('path').resolve(__dirname, '..'), stdio: 'ignore' }); // 新バージョン
  await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await p.getByRole('button', { name: '更新' }).waitFor({ timeout: 15000 });
  console.log('update banner shown');
  await Promise.all([p.waitForEvent('load'), p.getByRole('button', { name: '更新' }).click()]);
  await p.getByText('今日は').waitFor();
  const v2 = await p.evaluate(() => caches.keys());
  console.log('caches before', v1, 'after', v2);
  console.log('task kept after update:', await p.getByText('更新前のタスク').isVisible());
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
