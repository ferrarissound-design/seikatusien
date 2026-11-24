import { test, expect } from '@playwright/test';

// 端末の時計を進めて「日付をまたぐ」「給料日当日」を検証する（架空データ）

test('日付をまたぐと持ち物チェックが外れ、履歴に残る。未完了タスクは繰り越される', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-31T08:00:00+09:00') });
  await page.goto('/');
  await page.getByRole('button', { name: '設定をスキップして始める' }).click();
  await expect(page.getByText('2026年12月31日（木）')).toBeVisible();
  await page.goto('/#/checklists?new=1');
  await page.getByRole('button', { name: '日常の外出' }).click();
  await page.getByRole('checkbox', { name: '鍵' }).click();
  await expect(page.getByRole('checkbox', { name: '鍵' })).toHaveAttribute('aria-checked', 'true');
  await page.goto('/#/home');
  await page.getByRole('button', { name: 'タスク追加' }).click();
  await page.getByLabel('やること').fill('年末の書類');
  await page.getByRole('dialog').getByRole('button', { name: '追加' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 年をまたいで翌朝（リセット時刻 4:00 より後）にアプリを開く
  await page.clock.setSystemTime(new Date('2027-01-01T07:00:00+09:00'));
  await page.reload();
  await expect(page.getByText('2027年1月1日（金）')).toBeVisible();
  await expect(page.getByText('12/31（木）から繰り越し')).toBeVisible();
  await page.goto('/#/checklists');
  await page.getByText('日常の外出').click();
  await expect(page.getByRole('checkbox', { name: '鍵' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('link', { name: '履歴' }).click();
  await expect(page.getByText('2026年12月31日（木）')).toBeVisible();
  await expect(page.getByText('1 / 5')).toBeVisible();
});

test('給料日当日でも計算エラーにならず、次の給料日までで計算する', async ({ page }) => {
  await page.clock.install({ time: new Date('2027-01-25T10:00:00+09:00') }); // 月曜
  await page.goto('/');
  await page.getByRole('button', { name: '設定をスキップして始める' }).click();
  await expect(page.getByText('今日は')).toBeVisible();
  await page.goto('/#/money/setup');
  await page.getByLabel('毎月の給料日').selectOption('25');
  await page.getByLabel('いまの残高').fill('31000');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByTestId('money-today')).toHaveText('1,000円'); // 31,000 ÷ 31日（1/25〜2/24）
  await page.getByRole('link', { name: '計算の内訳を見る' }).click();
  await expect(page.getByText('31日')).toBeVisible();
});

test('予算を超えても0円表示で、調整のヒントを出す', async ({ page }) => {
  await page.clock.install({ time: new Date('2027-02-10T10:00:00+09:00') });
  await page.goto('/');
  await page.getByRole('button', { name: '設定をスキップして始める' }).click();
  await expect(page.getByText('今日は')).toBeVisible();
  await page.goto('/#/money/setup');
  await page.getByLabel('毎月の給料日').selectOption('25');
  await page.getByLabel('いまの残高').fill('50000');
  await page.getByLabel('給料日までの予算（固定費を除く）').fill('3000');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByTestId('money-today')).toBeVisible();
  await page.getByRole('button', { name: '支出', exact: true }).click();
  await page.getByLabel('金額').fill('5000');
  await page.getByRole('button', { name: '食費' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.setSystemTime(new Date('2027-02-11T10:00:00+09:00'));
  await page.reload();
  await expect(page.getByTestId('money-today')).toHaveText('0円');
  await page.getByRole('link', { name: '調整のヒントを見る' }).click();
  await expect(page.getByText('調整のヒント')).toBeVisible();
  await expect(page.getByText(/2,000円 足りない見込み/)).toBeVisible();
});
