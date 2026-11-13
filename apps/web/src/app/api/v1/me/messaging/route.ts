// GET   /api/v1/me/messaging — trạng thái kênh nhận nhắc lịch (Telegram / Zalo) của tôi
// PATCH /api/v1/me/messaging — cập nhật Zalo user_id { zaloUserId: string | null }
import { z } from 'zod';

import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

const patchSchema = z.object({
  zaloUserId: z
    .string()
    .trim()
    .regex(/^\d{5,32}$/, 'Zalo user_id chỉ gồm chữ số')
    .nullable(),
});

async function state(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { telegramChatId: true, zaloUserId: true },
  });
  return {
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_BOT_USERNAME,
      botUsername: process.env.TELEGRAM_BOT_USERNAME ?? null,
      linked: !!u.telegramChatId,
    },
    zalo: {
      enabled: !!process.env.ZALO_APP_ID,
      userId: u.zaloUserId,
    },
  };
}

export const GET = withAuth(async ({ user }) => ok(await state(user.id)));

export const PATCH = withAuth(async ({ req, user }) => {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ', {
      status: 422,
    });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { zaloUserId: parsed.data.zaloUserId },
  });
  return ok(await state(user.id));
});
