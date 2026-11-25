import { test, expect, type Page } from '@playwright/test';
import { audit } from './audit';

// バックアップの声かけ（架空のデータ）

const DAY = 86_400_000;
const T0 = new Date('2027-03-01T09:00:00+09:00').getTime();

async function startWithRecord(page: Page) {
  await page.clock.install({ time: new Date(T0) });
  await page.goto('/');
  await page.getByRole('button', { name: '設定をスキップして始める' }).click();
  await expect(page.getByText('今日は')).toBeVisible();
  await page.getByRole('button', { name: 'タスク追加' }).click();
  await page.getByLabel('やること').fill('テスト用のタスク');
  await page.getByRole('dialog').getByRole('button', { name: '追加' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function goTo(page: Page, ms: number) {
  await page.clock.setSystemTime(new Date(ms));
  await page.reload();
  await expect(page.getByText('今日は')).toBeVisible();
}

test('始めたばかりは出ない。最初の記録から7日で出る', async ({ page }) => {
  await startWithRecord(page);
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
  await goTo(page, T0 + 6 * DAY);
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
  // 記録はT0の数秒後に作られるため、7日後＋1分で判定する
  await goTo(page, T0 + 7 * DAY + 60_000);
  await expect(page.getByTestId('backup-nudge')).toContainText('まだバックアップをしていません。');
});

test('記録がなければ出ない', async ({ page }) => {
  await page.clock.install({ time: new Date(T0) });
  await page.goto('/');
  await page.getByRole('button', { name: '設定をスキップして始める' }).click();
  await expect(page.getByText('今日は')).toBeVisible();
  await goTo(page, T0 + 30 * DAY);
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
});

test('「あとで」で7日間出ない。7日後にまた出る', async ({ page }) => {
  await startWithRecord(page);
  await goTo(page, T0 + 8 * DAY);
  await page.getByTestId('backup-nudge').getByRole('button', { name: 'あとで' }).click();
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
  await goTo(page, T0 + 14 * DAY);
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
  await goTo(page, T0 + 15 * DAY + 60_000);
  await expect(page.getByTestId('backup-nudge')).toBeVisible();
});

test('書き出すと消え、14日後に日数つきで出る', async ({ page }) => {
  await startWithRecord(page);
  await goTo(page, T0 + 8 * DAY);
  await page.getByTestId('backup-nudge').getByRole('link', { name: 'バックアップする' }).click();
  await expect(page.getByRole('heading', { name: 'バックアップ' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'バックアップを書き出す' }).click();
  await download;
  await expect(page.getByText('バックアップを書き出しました')).toBeVisible();
  await page.goto('/#/home');
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
  await goTo(page, T0 + 8 * DAY + 13 * DAY);
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
  await goTo(page, T0 + 8 * DAY + 14 * DAY + 60_000);
  await expect(page.getByTestId('backup-nudge')).toContainText('最後のバックアップから14日たちました。');
});

test.describe('アクセシビリティ（375px）', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const scheme of ['light', 'dark'] as const) {
    for (const scale of ['ふつう', 'とても大きい']) {
      test(`${scheme} 文字${scale}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await startWithRecord(page);
        await page.goto('/#/settings/display');
        await page.getByRole('group', { name: '文字の大きさ' }).getByRole('button', { name: scale, exact: true }).click();
        await page.goto('/#/home');
        await goTo(page, T0 + 8 * DAY);
        await expect(page.getByTestId('backup-nudge')).toBeVisible();
        await page.waitForTimeout(200);
        const problems = await audit(page);
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  }
});
