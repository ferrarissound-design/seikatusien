import { test, expect, type Page } from '@playwright/test';

// ホーム画面の改善に関するテスト（架空のデータ）

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '設定をスキップして始める' }).click();
  await expect(page.getByText('今日は')).toBeVisible();
}

test.describe('お金カード', () => {
  test('未設定：0円を出さず、「お金の設定をする」だけが塗りつぶしボタン', async ({ page }) => {
    await start(page);
    const card = page.getByTestId('money-card');
    await expect(card).toHaveAttribute('data-state', 'unset');
    await expect(card).not.toContainText(/[0-9０-９]+円|¥/);
    await expect(card.getByRole('link', { name: 'お金の設定をする' })).toHaveClass(/\bprimary\b/);
    const expense = card.getByRole('button', { name: '支出を記録' });
    await expect(expense).toHaveClass(/\boutline\b/);
    await expect(expense).not.toHaveClass(/\bprimary\b/);
  });

  test('設定後：1日の目安を大きく表示し、残り日数と残高を出す', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-01-25T10:00:00+09:00') });
    await start(page);
    await page.goto('/#/money/setup');
    await page.getByLabel('毎月の給料日').selectOption('25');
    await page.getByLabel('いまの残高').fill('31000');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByTestId('money-today')).toBeVisible();
    await page.goto('/#/home');
    const card = page.getByTestId('money-card');
    await expect(card).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('daily-allowance')).toHaveText('1,000円／日');
    await expect(card).toContainText('次の給料日まで、今日を含めて 31日');
    await expect(card).toContainText('いまの残高');
    await expect(card).toContainText('31,000円');
    // メインボタンは「支出を記録」だけ
    await expect(card.getByRole('link', { name: 'お金の設定をする' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: '支出を記録' })).toBeVisible();
    // 文字サイズ（hero-amount）は本文より十分大きい
    const fs = await page.getByTestId('daily-allowance').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeGreaterThanOrEqual(40);
  });

  test('記録だけある：目安（0円）は出さず、支出を記録がメインボタン', async ({ page }) => {
    await start(page);
    const card = page.getByTestId('money-card');
    await card.getByRole('button', { name: '支出を記録' }).click();
    await page.getByLabel('金額').fill('500');
    await page.getByRole('button', { name: 'コンビニ' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card).toHaveAttribute('data-state', 'recordsOnly');
    await expect(card).toContainText('残高か予算を登録すると、1日の目安が出ます。');
    await expect(card).not.toContainText(/[0-9０-９]+円/);
    await expect(card.getByRole('button', { name: '支出を記録' })).toHaveClass(/\bprimary\b/);
  });

  test('給料日が未設定なら「今月末まで」と表示する', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-01-25T10:00:00+09:00') });
    await start(page);
    await page.goto('/#/money/setup');
    await page.getByLabel('いまの残高').fill('7000');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByTestId('money-today')).toBeVisible();
    await page.goto('/#/home');
    await expect(page.getByTestId('money-card')).toContainText('今月末まで、今日を含めて 7日');
  });
});

test.describe('保存状況の表示', () => {
  test('短い文言で表示し、タップすると説明のある設定画面を開く', async ({ page }) => {
    await start(page);
    const badge = page.getByTestId('sync-badge');
    await expect(badge).toContainText('このスマホだけに保存しています');
    await expect(badge).not.toContainText('クラウドバックアップは未設定です');
    // 色の点だけでなく、アイコン（形）と文字で伝える
    await expect(badge.locator('svg').first()).toBeVisible();
    await expect(page.locator('.status-dot')).toHaveCount(0);
    const box = await badge.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await badge.click();
    await expect(page.getByRole('heading', { name: '保存と同期' })).toBeVisible();
    await expect(page.getByText('この端末への保存について')).toBeVisible();
  });
});

test.describe('ブランドと励まし', () => {
  test('Life Partner の名前は日付の見出しより控えめ、励ましの一言がある', async ({ page }) => {
    await start(page);
    const brand = page.locator('.brand');
    await expect(brand).toContainText('Life Partner');
    await expect(brand.locator('img')).toHaveAttribute('aria-hidden', 'true');
    const brandSize = await brand.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const h1Size = await page.locator('h1').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(brandSize).toBeLessThan(h1Size);
    const gentle = page.locator('.gentle-card');
    await expect(gentle).toHaveText(/ひとつずつで、大丈夫。/);
    await expect(gentle.locator('[aria-hidden="true"]')).toHaveCount(1);
    await expect(gentle).not.toContainText(/[A-Za-z]/);
  });
});

test('文字サイズ最大でも「◯日」が途中で改行されない', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.install({ time: new Date('2027-01-20T10:00:00+09:00') });
  await start(page);
  await page.goto('/#/settings/display');
  await page.getByRole('group', { name: '文字の大きさ' }).getByRole('button', { name: 'とても大きい', exact: true }).click();
  await page.goto('/#/money/setup');
  await page.getByLabel('毎月の給料日').selectOption('25');
  await page.getByLabel('いまの残高').fill('123456');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByTestId('money-today')).toBeVisible();
  await page.goto('/#/home');
  const days = page.locator('.hero-caption strong').first();
  await expect(days).toHaveText('5日');
  // 「5」と「日」は別のテキストとして描画されるため、行の位置（上端）が同じかで判定する
  const tops = await days.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return [...new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top)))];
  });
  expect(tops).toHaveLength(1);
});

test('文字サイズ最大・未設定でも「計算の内訳」が途中で改行されない', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page);
  await page.goto('/#/settings/display');
  await page.getByRole('group', { name: '文字の大きさ' }).getByRole('button', { name: 'とても大きい', exact: true }).click();
  await page.goto('/#/home');
  const link = page.getByTestId('money-card').locator('xpath=ancestor::section[1]').getByRole('link', { name: '計算の内訳' });
  const tops = await link.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return [...new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top)))];
  });
  expect(tops).toHaveLength(1);
});
