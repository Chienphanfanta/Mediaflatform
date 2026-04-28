// PUT /api/v1/alerts/:id/read — đánh dấu 1 alert là đã đọc
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';

export const PUT = withAuth<{ id: string }>(
  async ({ user, params }) => {
    const groupIds = user.groups.map((g) => g.id);

    const alert = await prisma.alert.findFirst({
      where: {
        id: params.id,
        ...(user.isSuperAdmin
          ? {}
          : { channel: { groups: { some: { groupId: { in: groupIds } } } } }),
      },
    });
    if (!alert) {
      return fail('ALERT_NOT_FOUND', 'Không tìm thấy alert hoặc không có quyền', {
        status: 404,
      });
    }

    if (alert.isRead) return ok(alert);

    const updated = await prisma.alert.update({
      where: { id: params.id },
      data: { isRead: true, readAt: new Date() },
    });
    return ok(updated);
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
