// E2E: Login flow — happy path, sai mật khẩu, forgot password redirect.
import { expect, test } from '@playwright/test';

import { TEST_USERS } from './fixtures';

test.describe('Login flow', () => {
  test('redirect /login khi chưa auth', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login đúng credentials → /dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_USERS.superadmin.email);
    await page.getByLabel(/mật khẩu/i).fill(TEST_USERS.superadmin.password);
    await page.getByRole('button', { name: /đăng nhập/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    // Sidebar/topbar load → app shell rendered
    await expect(
      page.getByRole('navigation', { name: /main|sidebar/i }).first(),
    ).toBeVisible();
  });

  test('login sai mật khẩu → error inline', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_USERS.superadmin.email);
    await page.getByLabel(/mật khẩu/i).fill('wrong-password');
    await page.getByRole('button', { name: /đăng nhập/i }).click();

    // Vẫn ở /login + có thông báo lỗi
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/sai|không đúng|lỗi/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('email không tồn tại → error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('nobody@example.com');
    await page.getByLabel(/mật khẩu/i).fill('Whatever123');
    await page.getByRole('button', { name: /đăng nhập/i }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/sai|không tồn tại|lỗi/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('forgot password link → /forgot-password (Phase 9 chưa setup)', async ({
    page,
  }) => {
    await page.goto('/login');
    const forgotLink = page.getByRole('link', { name: /quên mật khẩu/i });
    if ((await forgotLink.count()) === 0) {
      test.skip(true, 'Forgot password chưa implement');
    }
    await forgotLink.click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });
});
