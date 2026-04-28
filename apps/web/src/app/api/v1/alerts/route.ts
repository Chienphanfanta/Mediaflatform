// GET /api/v1/alerts — list alerts trong scope user (qua channel membership).
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { listAlertsQuerySchema } from '@/lib/schemas/alerts';

export const GET = withAuth(
  async ({ req, user }) => {
    const url = new URL(req.url);
    const parsed = listAlertsQuerySchema.safeParse({
      status: url.searchParams.get('status') ?? undefined,
      severity: url.searchParams.getAll('severity'),
      type: url.searchParams.getAll('type'),
      channelId: url.searchParams.get('channelId') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    });
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Query không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { status, severity, type, channelId, page, pageSize } = parsed.data;

    // Scope: chỉ alerts thuộc channel user có quyền
    const userGroupIds = user.groups.map((g) => g.id);
    const channelWhere: Prisma.ChannelWhereInput = user.isSuperAdmin
      ? { deletedAt: null }
      : { deletedAt: null, groups: { some: { groupId: { in: userGroupIds } } } };

    if (channelId) {
      // Verify access
      const ch = await prisma.channel.findFirst({
        where: { ...channelWhere, id: channelId },
        select: { id: true },
      });
      if (!ch) {
        return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh hoặc không có quyền', {
          status: 404,
        });
      }
    }

    const channels = await prisma.channel.findMany({
      where: channelWhere,
      select: { id: true },
    });
    const channelIds = channels.map((c) => c.id);
    if (channelIds.length === 0) {
      return ok({
        items: [],
        unreadCount: 0,
        pagination: { page, pageSize, total: 0, totalPages: 0 },
      });
    }

    const where: Prisma.AlertWhereInput = {
      channelId: channelId ? channelId : { in: channelIds },
    };
    if (status === 'unread') where.isRead = false;
    else if (status === 'read') where.isRead = true;
    if (severity.length) where.severity = { in: severity };
    if (type.length) where.type = { in: type };

    const [items, total, unreadCount] = await Promise.all([
      prisma.alert.findMany({
        where,
        orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: { select: { id: true, name: true, platform: true } },
        },
      }),
      prisma.alert.count({ where }),
      prisma.alert.count({
        where: { channelId: { in: channelIds }, isRead: false },
      }),
    ]);

    return ok({
      items,
      unreadCount,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  },
  { rateLimit: { limit: 120, windowMs: 60_000 } },
);
