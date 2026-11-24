import { test, expect, type Page } from '@playwright/test';
import { audit } from './audit';

// 体重の記録（架空のデータ）

async function startWithWeight(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '設定をスキップして始める' }).click();
  await expect(page.getByText('今日は')).toBeVisible();
  await page.goto('/#/settings/features');
  await page.getByRole('switch', { name: /体重/ }).click();
  await expect(page.getByRole('switch', { name: /体重/ })).toBeChecked();
  await page.goto('/#/home');
}

test('体重：初期状態ではホームに出ない。設定でオンにすると出る', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '設定をスキップして始める' }).click();
  await expect(page.getByText('今日は')).toBeVisible();
  await expect(page.getByTestId('weight-card')).toHaveCount(0);
  await page.goto('/#/settings/features');
  await page.getByRole('switch', { name: /体重/ }).click();
  await expect(page.getByRole('switch', { name: /体重/ })).toBeChecked();
  await page.goto('/#/home');
  await expect(page.getByTestId('weight-card')).toBeVisible();
});

test('体重：ホームから記録 → 再読み込み後も残る → 増減は矢印と文字で表示', async ({ page }) => {
  await page.clock.install({ time: new Date('2027-01-20T07:30:00+09:00') });
  await startWithWeight(page);
  const card = page.getByTestId('weight-card');
  await card.getByRole('button', { name: '今日の体重を記録' }).click();
  await page.getByLabel('体重（kg・小数第2位まで）').fill('65.456');
  await expect(page.getByText('小数第2位までの数字で入力してください')).toBeVisible();
  await expect(page.getByRole('button', { name: '記録する' })).toBeDisabled();
  await page.getByLabel('体重（kg・小数第2位まで）').fill('65.45');
  await page.getByRole('button', { name: '記録する' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toContainText('65.45kg');

  await page.clock.setSystemTime(new Date('2027-01-21T07:30:00+09:00'));
  await page.reload();
  await card.getByRole('button', { name: '今日の体重を記録' }).click();
  await page.getByLabel('体重（kg・小数第2位まで）').fill('６５．２');
  await page.getByRole('button', { name: '記録する' }).click();
  await expect(card).toContainText('65.2kg');
  await expect(card).toContainText('前回から ↓ 0.25kg');
  await page.reload();
  await expect(card).toContainText('65.2kg');
});

test('体重：一覧・グラフ・表・編集・削除と元に戻す', async ({ page }) => {
  await page.clock.install({ time: new Date('2027-01-20T07:30:00+09:00') });
  await startWithWeight(page);
  for (const [d, v] of [['2027-01-18', '64.8'], ['2027-01-19', '65.1'], ['2027-01-20', '65']] as const) {
    await page.goto('/#/weight');
    await page.getByRole('button', { name: '体重を記録' }).click();
    await page.getByLabel('体重（kg・小数第2位まで）').fill(v);
    await page.getByText('日付・時刻・メモ（任意）').click();
    await page.getByLabel('日付').fill(d);
    await page.getByRole('button', { name: '記録する' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.getByRole('img', { name: /体重の推移/ })).toBeVisible();
  await page.getByText('表で見る').click();
  await expect(page.locator('.weight-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.weight-table tbody tr').first()).toContainText('65.0kg');

  await page.getByRole('button', { name: /65\.0kg を編集/ }).click();
  await page.getByLabel('体重（kg・小数第2位まで）').fill('65.05');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('button', { name: /65\.05kg を編集/ })).toBeVisible();

  await page.getByRole('button', { name: /65\.05kg を編集/ }).click();
  await page.getByRole('button', { name: '削除' }).click();
  await expect(page.getByRole('button', { name: /65\.05kg を編集/ })).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す' }).last().click();
  await expect(page.getByRole('button', { name: /65\.05kg を編集/ })).toBeVisible();
});

test.describe('体重：アクセシビリティ（375px）', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const scheme of ['light', 'dark'] as const) {
    for (const scale of ['ふつう', 'とても大きい']) {
      test(`${scheme} 文字${scale}：ホームのカードと体重画面`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.clock.install({ time: new Date('2027-01-20T07:30:00+09:00') });
        await startWithWeight(page);
        await page.goto('/#/settings/display');
        await page.getByRole('group', { name: '文字の大きさ' }).getByRole('button', { name: scale, exact: true }).click();
        for (const [d, v] of [['2027-01-19', '123.45'], ['2027-01-20', '123.4']] as const) {
          await page.goto('/#/weight');
          await page.getByRole('button', { name: '体重を記録' }).click();
          await page.getByLabel('体重（kg・小数第2位まで）').fill(v);
          await page.getByText('日付・時刻・メモ（任意）').click();
          await page.getByLabel('日付').fill(d);
          await page.getByRole('button', { name: '記録する' }).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
        for (const path of ['/#/home', '/#/weight']) {
          await page.goto(path);
          await page.waitForTimeout(200);
          const problems = await audit(page);
          expect(problems, `${path}\n${problems.join('\n')}`).toEqual([]);
        }
      });
    }
  }
});

test('体重：今日より後の日付では記録できない', async ({ page }) => {
  await page.clock.install({ time: new Date('2027-01-20T07:30:00+09:00') });
  await startWithWeight(page);
  await page.goto('/#/weight');
  await page.getByRole('button', { name: '体重を記録' }).click();
  await page.getByLabel('体重（kg・小数第2位まで）').fill('60');
  await page.getByText('日付・時刻・メモ（任意）').click();
  await page.getByLabel('日付').fill('2027-01-21');
  await expect(page.getByText('今日より後の日付は選べません')).toBeVisible();
  await expect(page.getByRole('button', { name: '記録する' })).toBeDisabled();
});
