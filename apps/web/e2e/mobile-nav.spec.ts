// E2E mobile-only: Bottom nav 5 tabs trên iPhone viewport.
//
// File này chỉ chạy ở project `mobile-safari` (xem playwright.config.ts).
import { expect, test } from './fixtures';

test.describe('Mobile bottom navigation', () => {
  test('5 tabs hiển thị + click chuyển page', async ({ authedPage: page }) => {
    await page.goto('/dashboard');

    // Bottom nav fixed ở đáy
    const bottomNav = page.getByRole('navigation', { name: /bottom/i });
    await expect(bottomNav).toBeVisible();

    // 5 tab labels
    await expect(bottomNav.getByText(/tổng quan/i)).toBeVisible();
    await expect(bottomNav.getByText(/lịch/i)).toBeVisible();
    await expect(bottomNav.getByText(/kênh/i)).toBeVisible();
    await expect(bottomNav.getByText(/số liệu/i)).toBeVisible();
    await expect(bottomNav.getByText(/menu/i)).toBeVisible();

    // Click "Lịch" → /calendar
    await bottomNav.getByText(/lịch/i).click();
    await expect(page).toHaveURL(/\/calendar/);

    // Click "Số liệu" → /analytics
    await bottomNav.getByText(/số liệu/i).click();
    await expect(page).toHaveURL(/\/analytics/);

    // Click "Menu" → bottom sheet mở
    await bottomNav.getByText(/menu/i).click();
    await expect(
      page.getByRole('dialog').getByText(/menu|reports|báo cáo/i).first(),
    ).toBeVisible();
  });

  test('Sidebar desktop ẨN trên mobile', async ({ authedPage: page }) => {
    await page.goto('/dashboard');
    // Sidebar có aria-label "Sidebar" — bị `hidden sm:flex` ở mobile
    const sidebar = page.getByRole('complementary', { name: /sidebar/i });
    if (await sidebar.count() > 0) {
      await expect(sidebar).not.toBeVisible();
    }
  });

  test('FAB tạo bài hiện trên /calendar mobile', async ({ authedPage: page }) => {
    await page.goto('/calendar');
    // FAB có aria-label "Tạo bài mới"
    const fab = page.getByRole('button', { name: /tạo bài mới/i });
    await expect(fab).toBeVisible();
  });
});
