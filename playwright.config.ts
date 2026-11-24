import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// クラウド開発環境では事前インストール済みの Chromium を使う
const exe = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(exe) ? { executablePath: exe } : {};

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    launchOptions,
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
