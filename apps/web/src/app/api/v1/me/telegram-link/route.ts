// POST   /api/v1/me/telegram-link — tạo link t.me/<bot>?start=<mã> để liên kết Telegram
// DELETE /api/v1/me/telegram-link — huỷ liên kết
// Bot nhận "/start <mã>" → api (PostReminderService) gán User.telegramChatId.
import crypto from 'node:crypto';

import { fail, noContent, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

export const POST = withAuth(
  async ({ user }) => {
    const bot = process.env.TELEGRAM_BOT_USERNAME;
    if (!bot || !process.env.TELEGRAM_BOT_TOKEN) {
      return fail('TELEGRAM_NOT_CONFIGURED', 'Hệ thống chưa cấu hình bot Telegram', {
        status: 400,
      });
    }
    const code = crypto.randomBytes(12).toString('base64url');
    await prisma.user.update({ where: { id: user.id }, data: { telegramLinkCode: code } });
    return ok({ url: `https://t.me/${bot.replace(/^@/, '')}?start=${code}` });
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);

export const DELETE = withAuth(async ({ user }) => {
  await prisma.user.update({
    where: { id: user.id },
    data: { telegramChatId: null, telegramLinkCode: null },
  });
  return noContent();
});
