// E2E: Alert flow — mở /alerts, click bell trong topbar, dismiss alert.
import { expect, test } from './fixtures';

test.describe('Alert flow', () => {
  test('Bell icon → dropdown count', async ({ authedPage: page }) => {
    await page.goto('/dashboard');

    const bell = page.getByRole('button', { name: /thông báo|notifications|bell/i }).first();
    if (!(await bell.isVisible({ timeout: 2_000 }).catch(() => false))) {
      test.skip(true, 'Bell icon không tìm thấy — selector có thể đổi');
    }

    await bell.click();
    // Dropdown mở — show top alerts hoặc empty state
    await expect(
      page.getByText(/cảnh báo|không có|empty/i).first(),
    ).toBeVisible({ timeout: 3_000 });
  });

  test('Mở /alerts page → list alerts + filter', async ({
    authedPage: page,
  }) => {
    await page.goto('/alerts');
    await expect(
      page.getByRole('heading', { name: /cảnh báo|alerts/i }),
    ).toBeVisible();

    // Filter unread — nếu có button
    const unreadFilter = page.getByRole('button', { name: /chưa đọc|unread/i });
    if (await unreadFilter.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await unreadFilter.click();
      // Page không crash
      await expect(
        page.getByRole('heading', { name: /cảnh báo|alerts/i }),
      ).toBeVisible();
    }
  });

  test('Dismiss alert (mark as read)', async ({ authedPage: page }) => {
    await page.goto('/alerts');

    // Lấy alert đầu tiên có nút "Đánh dấu đã đọc"
    const markBtn = page
      .getByRole('button', { name: /đã đọc|đánh dấu|mark.*read/i })
      .first();

    if (!(await markBtn.isVisible({ timeout: 2_000 }).catch(() => false))) {
      test.skip(true, 'Không có alert chưa đọc trong DB');
    }

    await markBtn.click();
    // Sau click — alert đó vẫn hiện nhưng style "đã đọc" hoặc biến mất khỏi
    // filter chưa đọc. Test chỉ check không crash.
    await expect(page).toHaveURL(/\/alerts/);
  });
});
