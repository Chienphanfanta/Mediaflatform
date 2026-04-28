// GET /api/v1/channels — list channels trong scope.
// ?stats=1 → kèm monthStats (views, posts, watchTime tháng này) + metadata + lastSyncedAt.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { ok } from '@/lib/api-response';

export const GET = withAuth(
  async ({ req, user }) => {
    const url = new URL(req.url);
    const includeStats = url.searchParams.get('stats') === '1';
    const groupIds = user.groups.map((g) => g.id);
    const where: Prisma.ChannelWhereInput = user.isSuperAdmin
      ? { deletedAt: null }
      : { deletedAt: null, groups: { some: { groupId: { in: groupIds } } } };

    const rows = await prisma.channel.findMany({
      where,
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        platform: true,
        status: true,
        accountId: true,
        tokenExpiresAt: true,
        ...(includeStats && {
          metadata: true,
          updatedAt: true,
        }),
        groups: { select: { groupId: true, group: { select: { name: true } } } },
      },
    });

    if (!includeStats) {
      return ok(
        rows.map((c) => ({
          id: c.id,
          name: c.name,
          platform: c.platform,
          status: c.status,
          accountId: c.accountId,
          groupIds: c.groups.map((g) => g.groupId),
        })),
      );
    }

    // Aggregate monthly stats: views, watchTime, posts cho tháng hiện tại
    const channelIds = rows.map((c) => c.id);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const today = new Date();

    const analyticsAgg =
      channelIds.length === 0
        ? []
        : await prisma.analytics.groupBy({
            by: ['channelId'],
            where: {
              channelId: { in: channelIds },
              date: { gte: monthStart, lte: today },
            },
            _sum: { views: true, watchTimeHours: true, subscriberDelta: true },
            _avg: { engagementRate: true },
          });

    const aggMap = new Map(
      (analyticsAgg as Array<Record<string, any>>).map((a) => [a.channelId, a]),
    );

    return ok(
      rows.map((c) => {
        const meta = (c.metadata as Record<string, unknown> | null) ?? null;
        const agg = aggMap.get(c.id);
        return {
          id: c.id,
          name: c.name,
          platform: c.platform,
          status: c.status,
          accountId: c.accountId,
          tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
          groupIds: c.groups.map((g) => g.groupId),
          groupNames: c.groups.map((g) => g.group.name),
          metadata: meta,
          thumbnailUrl:
            (meta?.thumbnailUrl as string | undefined) ??
            (meta?.profileImageUrl as string | undefined) ??
            (meta?.profilePictureUrl as string | undefined) ??
            null,
          subscriberCount:
            (meta?.subscriberCount as number | undefined) ??
            (meta?.followersCount as number | undefined) ??
            (meta?.fanCount as number | undefined) ??
            (meta?.memberCount as number | undefined) ??
            null,
          lastSyncedAt: (meta?.lastSyncedAt as string | undefined) ?? null,
          monthStats: {
            views: Number(agg?._sum?.views ?? 0),
            watchTimeHours:
              Math.round(Number(agg?._sum?.watchTimeHours ?? 0) * 10) / 10,
            subscriberDelta: Number(agg?._sum?.subscriberDelta ?? 0),
            engagementRate:
              Math.round(Number(agg?._avg?.engagementRate ?? 0) * 100) / 100,
          },
        };
      }),
    );
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
