// POST   /api/v1/notifications/subscribe   — lưu push subscription cho device hiện tại
// DELETE /api/v1/notifications/subscribe?endpoint=...  — xoá subscription (logout / opt-out)
//
// Schema: UserDevice unique trên endpoint → upsert idempotent (re-subscribe trên
// cùng device update p256dh/auth nếu user đổi).
import { z } from 'zod';

import { fail, noContent, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
});

export const POST = withAuth(async ({ req, user }) => {
  const body = await req.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', 'Subscription không hợp lệ', {
      status: 422,
      details: parsed.error.issues,
    });
  }
  const { endpoint, keys, userAgent } = parsed.data;

  // Upsert qua endpoint unique. Nếu endpoint đã thuộc user khác (lạ), gắn lại
  // sang user hiện tại — usually sau logout/login lại trên cùng device.
  const device = await prisma.userDevice.upsert({
    where: { endpoint },
    create: {
      userId: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? null,
    },
    update: {
      userId: user.id,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? null,
      lastSeenAt: new Date(),
    },
    select: { id: true, createdAt: true },
  });

  // Đảm bảo có UserNotificationSettings row (default tất cả ON)
  await prisma.userNotificationSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {}, // không đổi nếu đã tồn tại
  });

  return ok({ id: device.id, createdAt: device.createdAt }, { status: 201 });
});

export const DELETE = withAuth(async ({ req, user }) => {
  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint');
  if (!endpoint) {
    return fail('VALIDATION_FAILED', 'Cần query param endpoint', { status: 422 });
  }
  // Chỉ xoá nếu endpoint thuộc user — tránh user A xoá device của user B
  await prisma.userDevice.deleteMany({
    where: { endpoint, userId: user.id },
  });
  return noContent();
});
