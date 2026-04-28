// GET /api/v1/channels/:id/sync-logs?limit=20
// Trả N sync logs gần nhất của 1 channel (sorted desc by createdAt).
// Permission: STAFF+ trong group sở hữu channel.
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';

export const GET = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1),
      100,
    );

    // Verify scope: channel phải thuộc group user (extension đã filter tenantId)
    const channel = await prisma.channel.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { groups: { select: { groupId: true } } },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh', { status: 404 });
    }

    if (!user.isSuperAdmin) {
      const userGroupIds = new Set(user.groups.map((g) => g.id));
      const overlap = channel.groups.some((g) => userGroupIds.has(g.groupId));
      if (!overlap) {
        return fail('FORBIDDEN', 'Kênh không thuộc nhóm của bạn', { status: 403 });
      }
    }

    const logs = await prisma.syncLog.findMany({
      where: { channelId: params.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        platform: true,
        date: true,
        status: true,
        recordsUpdated: true,
        durationMs: true,
        jobId: true,
        errorMessage: true,
        metadata: true,
        createdAt: true,
      },
    });

    return ok({
      items: logs.map((l) => ({
        ...l,
        date: l.date?.toISOString() ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
      total: logs.length,
    });
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
