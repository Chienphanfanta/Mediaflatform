// Playwright config — E2E browser tests cho apps/web.
//
// Chạy:
//   npx playwright install --with-deps chromium webkit  (1 lần)
//   npx playwright test                                  (full suite)
//   npx playwright test --ui                             (debug)
//
// Yêu cầu app đang chạy ở BASE_URL — webServer auto-start `next dev` nếu
// PLAYWRIGHT_AUTOSTART=1; production CI dùng `next start` build sẵn.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // CI: 1 worker khi test ghi DB chung — tránh race
  fullyParallel: !process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
      // Chỉ chạy mobile-specific tests trên project này
      testMatch: /mobile-.*\.spec\.ts/,
    },
  ],

  webServer: process.env.PLAYWRIGHT_AUTOSTART
    ? {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
