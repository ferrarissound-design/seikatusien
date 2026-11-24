import { test, expect, type Page } from '@playwright/test';

// すべて架空のデータで検証する

async function skipOnboarding(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '設定をスキップして始める' }).click();
  await expect(page.getByText('今日は')).toBeVisible();
}

test('初回起動：設定をスキップしてホームが表示される', async ({ page }) => {
  await skipOnboarding(page);
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible();
  await expect(page.getByText('この端末にのみ保存')).toBeVisible();
});

test('忘れ物チェック：テンプレートから作成・チェックが再読み込み後も残る', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByRole('link', { name: '忘れ物' }).click();
  await page.getByRole('button', { name: 'リストを作る' }).click();
  await page.getByRole('button', { name: '通院' }).click();
  await expect(page.getByRole('heading', { name: '通院' })).toBeVisible();
  await page.getByRole('checkbox', { name: '診察券' }).click();
  await expect(page.getByRole('checkbox', { name: '診察券' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('textbox', { name: '持ち物を追加' }).fill('傘');
  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByRole('checkbox', { name: '傘' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: '診察券' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: '傘' })).toBeVisible();
  // ホームからも確認できる
  await page.getByRole('link', { name: 'ホーム' }).click();
  await expect(page.getByText(/1 \/ 8 確認/)).toBeVisible();
});

test('タスク：分解して登録・ステップ完了・タスク完了', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByRole('link', { name: 'タスク', exact: true }).click();
  await page.locator('.fab').click();
  await page.getByLabel('やること').fill('部屋を掃除する');
  await page.getByLabel(/小さなステップに分ける/).fill('ゴミを集める\nゴミを捨てる');
  await page.getByRole('dialog').getByRole('button', { name: '追加' }).click();
  await expect(page.getByText('0/2 ステップ')).toBeVisible();
  await page.getByRole('link', { name: '部屋を掃除するの詳細' }).click();
  await page.getByRole('checkbox', { name: 'ゴミを集める' }).click();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await page.getByRole('button', { name: '完了にする' }).click();
  await expect(page.getByText('✅ 完了')).toBeVisible();
});

test('集中モード：1つだけ表示される', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByRole('button', { name: 'タスク追加' }).click();
  await page.getByLabel('やること').fill('書類を出す');
  await page.getByRole('dialog').getByRole('button', { name: '追加' }).click();
  await page.getByRole('button', { name: 'タスク追加' }).click();
  await page.getByLabel('やること').fill('薬を受け取る');
  await page.getByRole('dialog').getByRole('button', { name: '追加' }).click();
  await page.getByRole('button', { name: '1つずつやる' }).click();
  await expect(page.getByText('いま取り組むこと')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toHaveCount(0);
  const first = await page.locator('.focus-title').textContent();
  await page.getByRole('button', { name: 'あとで取り組む（次のタスクへ）' }).click();
  await expect(page.locator('.focus-title')).not.toHaveText(first ?? '');
});

test('お金：残高・給料日を登録して支出を記録すると今日の残りが減る', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByRole('link', { name: 'お金', exact: true }).first().click();
  await page.getByRole('link', { name: '残高・予算を登録する' }).click();
  await page.getByLabel('毎月の給料日').selectOption('25');
  await page.getByLabel('いまの残高').fill('30000');
  await page.getByRole('button', { name: '保存' }).click();
  const before = await page.getByTestId('money-today').textContent();
  expect(before).toMatch(/円$/);
  await page.getByRole('button', { name: '支出', exact: true }).click();
  await page.getByLabel('金額').fill('１，２００');
  await page.getByRole('button', { name: '食費' }).click();
  await expect(page.getByText('食費 1,200円を記録しました')).toBeVisible();
  const after = await page.getByTestId('money-today').textContent();
  const n = (s: string | null) => Number((s ?? '').replace(/[^\d]/g, ''));
  expect(n(before) - n(after)).toBe(1200);
  await page.reload();
  expect(n(await page.getByTestId('money-today').textContent())).toBe(n(after));
  // 計算の内訳が確認できる
  await page.getByRole('link', { name: '計算の内訳を見る' }).click();
  await expect(page.getByText('÷ 残り日数（今日を含む）')).toBeVisible();
});

test('削除は元に戻せる', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByRole('button', { name: '支出を記録' }).first().click();
  await page.getByLabel('金額').fill('500');
  await page.getByRole('button', { name: 'コンビニ' }).click();
  await page.getByRole('link', { name: 'お金', exact: true }).first().click();
  await page.getByRole('button', { name: /コンビニ 500円 を編集/ }).click();
  await page.getByRole('button', { name: '削除' }).click();
  await expect(page.getByRole('button', { name: /コンビニ 500円 を編集/ })).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す' }).last().click();
  await expect(page.getByRole('button', { name: /コンビニ 500円 を編集/ })).toBeVisible();
});

test('不正なバックアップファイルを拒否する', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('/#/settings/backup');
  await page.locator('#backup-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByText('Life Partner のバックアップファイルではないようです。')).toBeVisible();
});

test('オフラインでも起動・記録でき、再読み込み後も残る', async ({ page, context }) => {
  await skipOnboarding(page);
  // Service Worker が有効になるのを待つ
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15_000 });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('今日は')).toBeVisible();
  await page.getByRole('button', { name: 'タスク追加' }).click();
  await page.getByLabel('やること').fill('オフラインで追加');
  await page.getByRole('dialog').getByRole('button', { name: '追加' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); // 保存完了（シートが閉じる）を待つ
  await expect(page.getByText('オフラインで追加')).toBeVisible();
  await page.reload();
  await expect(page.getByText('オフラインで追加')).toBeVisible();
  await context.setOffline(false);
});

test('iPhone幅で横スクロールが発生しない・入力欄は16px以上', async ({ page }) => {
  await skipOnboarding(page);
  for (const path of ['/#/home', '/#/checklists', '/#/tasks', '/#/money', '/#/settings', '/#/money/breakdown']) {
    await page.goto(path);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto('/#/money');
  await page.getByRole('button', { name: '支出', exact: true }).click();
  const fs = await page.getByLabel('金額').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fs).toBeGreaterThanOrEqual(16);
  // 拡大操作を禁止していない
  const vp = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(vp).not.toMatch(/user-scalable=no|maximum-scale=1/);
});
