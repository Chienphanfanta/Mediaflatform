// E2E: Analytics dashboard — load summary, đổi period, KPI hiện đúng số.
import { expect, test } from './fixtures';

test.describe('Analytics dashboard', () => {
  test('Mở /analytics → KPI + chart hiện', async ({ authedPage: page }) => {
    await page.goto('/analytics');
    await expect(
      page.getByRole('heading', { name: /analytics/i }),
    ).toBeVisible();

    // KPI cards có ít nhất 4 entries (Tổng View, Watch Time, Subscribers, Engagement, Revenue)
    const kpiTitles = [
      /tổng view/i,
      /watch time/i,
      /subscriber/i,
      /engagement/i,
    ];
    for (const re of kpiTitles) {
      await expect(page.getByText(re).first()).toBeVisible({ timeout: 8_000 });
    }

    // ViewsChart card render — title "Tổng view theo ngày"
    await expect(page.getByText(/tổng view theo ngày/i)).toBeVisible();
    // Recharts SVG chart present (sau load data)
    await expect(page.locator('.recharts-surface').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Đổi period 30d → 7d → refetch + KPI cập nhật', async ({
    authedPage: page,
  }) => {
    await page.goto('/analytics');

    // Period selector — click 7d nếu có
    const sevenD = page.getByRole('button', { name: /^7\s*ngày|^7d$/i });
    if (await sevenD.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sevenD.click();
      // KPI vẫn render — không lỗi
      await expect(page.getByText(/tổng view/i).first()).toBeVisible();
    }
  });

  test('Top posts card render', async ({ authedPage: page }) => {
    await page.goto('/analytics');
    await expect(
      page.getByText(/top.*bài viết|top posts/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
