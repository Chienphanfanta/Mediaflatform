// E2E: Tạo + schedule post từ /calendar.
//
// LƯU Ý dependence: cần ít nhất 1 channel ACTIVE trong DB sau seed.
import { expect, test } from './fixtures';

test.describe('Tạo bài đăng', () => {
  test('Mở calendar → tạo DRAFT post', async ({ authedPage: page }) => {
    await page.goto('/calendar');
    await expect(
      page.getByRole('heading', { name: /content calendar/i }),
    ).toBeVisible();

    // Click "Tạo bài" — desktop toolbar có button. Mobile có FAB.
    const addBtn = page.getByRole('button', { name: /tạo bài|thêm bài/i }).first();
    await addBtn.click();

    // Dialog mở
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Chọn platform đầu tiên
    await dialog.getByRole('checkbox').first().check();

    // Chọn channel đầu tiên trong list
    const channelCheckbox = dialog.getByRole('checkbox').nth(1);
    if (await channelCheckbox.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await channelCheckbox.check();
    }

    // Title + content
    const title = `E2E test post ${Date.now()}`;
    await dialog.getByLabel(/tiêu đề|title/i).fill(title);
    const contentField = dialog.getByLabel(/nội dung|content/i);
    if (await contentField.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await contentField.fill('Nội dung E2E test');
    }

    // Save DRAFT (không set scheduledAt)
    await dialog.getByRole('button', { name: /lưu|tạo/i }).click();

    // Dialog đóng + post mới hiện trong calendar
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 5_000 });
  });

  test('Schedule post — set giờ tương lai', async ({ authedPage: page }) => {
    await page.goto('/calendar');
    await page.getByRole('button', { name: /tạo bài|thêm bài/i }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('checkbox').first().check();
    const channelCheckbox = dialog.getByRole('checkbox').nth(1);
    if (await channelCheckbox.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await channelCheckbox.check();
    }

    const title = `E2E scheduled ${Date.now()}`;
    await dialog.getByLabel(/tiêu đề|title/i).fill(title);

    // Set scheduledAt = ngày mai 14:00 ICT
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);
    const isoLocal = tomorrow.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm

    const scheduledInput = dialog.getByLabel(/lên lịch|scheduled|giờ đăng/i);
    if (
      await scheduledInput
        .isVisible({ timeout: 1_000 })
        .catch(() => false)
    ) {
      await scheduledInput.fill(isoLocal);
    }

    // Status SCHEDULED nếu form có select
    const statusSelect = dialog.getByLabel(/trạng thái|status/i);
    if (
      await statusSelect.isVisible({ timeout: 1_000 }).catch(() => false)
    ) {
      await statusSelect.selectOption('SCHEDULED').catch(() => undefined);
    }

    await dialog.getByRole('button', { name: /lưu|tạo/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 5_000 });
  });
});
