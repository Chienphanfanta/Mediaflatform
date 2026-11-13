// GET /api/v1/posts/channels — kênh mà user được phép giao bài đăng (cho form soạn bài).
// Kèm danh sách người phụ trách + trình duyệt online để biết bài có được đăng ngay không.
import { ok } from '@/lib/api-response';
import { postableChannelWhere } from '@/lib/posts/access';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export const GET = withAuth(async ({ user }) => {
  const where = postableChannelWhere(user);
  if (!where) return ok({ items: [] });

  const rows = await prisma.channel.findMany({
    where,
    orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      platform: true,
      status: true,
      ownerships: {
        select: {
          role: true,
          employee: {
            select: {
              id: true,
              name: true,
              telegramChatId: true,
              zaloUserId: true,
              browsers: {
                where: { revokedAt: null },
                select: { lastSeenAt: true },
              },
            },
          },
        },
      },
    },
  });

  const now = Date.now();
  const items = rows.map((c) => {
    const owners = c.ownerships.map((o) => ({
      id: o.employee.id,
      name: o.employee.name,
      role: o.role,
      browsers: o.employee.browsers.length,
      browserOnline: o.employee.browsers.some(
        (b) => !!b.lastSeenAt && now - b.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
      ),
      canBeReminded: !!(o.employee.telegramChatId || o.employee.zaloUserId),
    }));
    return {
      id: c.id,
      name: c.name,
      platform: c.platform,
      status: c.status,
      owners,
      hasBrowser: owners.some((o) => o.browsers > 0),
      browserOnline: owners.some((o) => o.browserOnline),
    };
  });
  return ok({ items });
});
