// DELETE /api/v1/alerts/:id — xoá alert (hard delete, không soft)
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, noContent } from '@/lib/api-response';

export const DELETE = withAuth<{ id: string }>(
  async ({ user, params }) => {
    const groupIds = user.groups.map((g) => g.id);

    const alert = await prisma.alert.findFirst({
      where: {
        id: params.id,
        ...(user.isSuperAdmin
          ? {}
          : { channel: { groups: { some: { groupId: { in: groupIds } } } } }),
      },
      select: { id: true },
    });
    if (!alert) {
      return fail('ALERT_NOT_FOUND', 'Không tìm thấy alert hoặc không có quyền', {
        status: 404,
      });
    }

    await prisma.alert.delete({ where: { id: params.id } });
    return noContent();
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
