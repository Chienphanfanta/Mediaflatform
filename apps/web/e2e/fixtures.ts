// Shared fixtures cho E2E suite — login helpers + test data refs.
import { test as base, expect, type Page } from '@playwright/test';

export const TEST_USERS = {
  superadmin: { email: 'admin@mediaops.app', password: 'Test123!@#' },
  manager: { email: 'manager@mediaops.app', password: 'Test123!@#' },
  staff: { email: 'staff@mediaops.app', password: 'Test123!@#' },
} as const;

/** Login programmatically — tránh repeat UI flow trong mỗi test. */
export async function login(
  page: Page,
  who: keyof typeof TEST_USERS = 'superadmin',
): Promise<void> {
  const u = TEST_USERS[who];
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(u.email);
  await page.getByLabel(/mật khẩu/i).fill(u.password);
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  await page.waitForURL(/\/dashboard/);
}

/**
 * Test fixture với auto-login. Dùng:
 *   import { test } from './fixtures';
 *   test('...', async ({ authedPage }) => { ... });
 */
export const test = base.extend<{
  authedPage: Page;
}>({
  authedPage: async ({ page }, use) => {
    await login(page, 'superadmin');
    await use(page);
  },
});

export { expect };
