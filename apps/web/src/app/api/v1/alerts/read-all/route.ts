// PUT /api/v1/alerts/read-all — đánh dấu tất cả alert trong scope là đã đọc.
// Chú ý route này phải nằm TRƯỚC [id] trong filesystem để Next.js match đúng path tĩnh.
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { ok } from '@/lib/api-response';

export const PUT = withAuth(
  async ({ user }) => {
    const channels = await prisma.channel.findMany({
      where: user.isSuperAdmin
        ? { deletedAt: null }
        : {
            deletedAt: null,
            groups: { some: { groupId: { in: user.groups.map((g) => g.id) } } },
          },
      select: { id: true },
    });
    const ids = channels.map((c) => c.id);
    if (ids.length === 0) return ok({ count: 0 });

    const res = await prisma.alert.updateMany({
      where: { channelId: { in: ids }, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return ok({ count: res.count });
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
