// GET /api/v1/analytics/overview?period=30d&groupId?
// Tổng hợp views / watchTime / subscribersGained / revenue của các kênh user có quyền,
// so sánh với kỳ trước cùng độ dài.
import { Prisma } from '@prisma/client';
import { startOfDay, subDays } from 'date-fns';

import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { overviewQuerySchema } from '@/lib/schemas/analytics';

type Agg = {
  views: number;
  watchTimeHours: number;
  subscribersGained: number;
  revenue: number;
};

type MetricDelta = {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
};

function periodDays(p: '7d' | '30d' | '90d'): number {
  return { '7d': 7, '30d': 30, '90d': 90 }[p];
}

function delta(cur: number, prev: number): MetricDelta {
  const d = cur - prev;
  return {
    current: r2(cur),
    previous: r2(prev),
    delta: r2(d),
    deltaPct: prev > 0 ? r2((d / prev) * 100) : null,
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const GET = withAuth(
  async ({ req, user }) => {
    const url = new URL(req.url);
    const parsed = overviewQuerySchema.safeParse({
      period: url.searchParams.get('period') ?? undefined,
      groupId: url.searchParams.get('groupId') ?? undefined,
    });
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Query không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { period, groupId } = parsed.data;

    // Scope channels
    const userGroupIds = user.groups.map((g) => g.id);
    const channelWhere: Prisma.ChannelWhereInput = { deletedAt: null };

    if (groupId) {
      // Explicit group — user phải là member (hoặc SuperAdmin)
      if (!user.isSuperAdmin && !userGroupIds.includes(groupId)) {
        return fail('FORBIDDEN', 'Bạn không thuộc group này', { status: 403 });
      }
      channelWhere.groups = { some: { groupId } };
    } else if (!user.isSuperAdmin) {
      channelWhere.groups = { some: { groupId: { in: userGroupIds } } };
    }

    const channels = await prisma.channel.findMany({
      where: channelWhere,
      select: { id: true },
    });
    const channelIds = channels.map((c) => c.id);

    const days = periodDays(period);
    const now = new Date();
    const curTo = startOfDay(now);
    const curFrom = subDays(curTo, days - 1);
    const prevTo = subDays(curFrom, 1);
    const prevFrom = subDays(prevTo, days - 1);

    if (channelIds.length === 0) {
      const empty: Agg = { views: 0, watchTimeHours: 0, subscribersGained: 0, revenue: 0 };
      return ok({
        period,
        groupId: groupId ?? null,
        channelCount: 0,
        dateRange: {
          current: { from: isoDate(curFrom), to: isoDate(curTo) },
          previous: { from: isoDate(prevFrom), to: isoDate(prevTo) },
        },
        metrics: {
          views: delta(0, 0),
          watchTimeHours: delta(0, 0),
          subscribersGained: delta(0, 0),
          revenue: delta(0, 0),
        },
      });
    }

    const sumSelect = {
      views: true,
      watchTimeHours: true,
      subscriberDelta: true,
      revenue: true,
    } as const;

    const [curAgg, prevAgg] = await Promise.all([
      prisma.analytics.aggregate({
        where: { channelId: { in: channelIds }, date: { gte: curFrom, lte: curTo } },
        _sum: sumSelect,
      }),
      prisma.analytics.aggregate({
        where: { channelId: { in: channelIds }, date: { gte: prevFrom, lte: prevTo } },
        _sum: sumSelect,
      }),
    ]);

    const cur: Agg = {
      views: Number(curAgg._sum.views ?? 0),
      watchTimeHours: Number(curAgg._sum.watchTimeHours ?? 0),
      subscribersGained: Number(curAgg._sum.subscriberDelta ?? 0),
      revenue: Number(curAgg._sum.revenue ?? 0),
    };
    const prev: Agg = {
      views: Number(prevAgg._sum.views ?? 0),
      watchTimeHours: Number(prevAgg._sum.watchTimeHours ?? 0),
      subscribersGained: Number(prevAgg._sum.subscriberDelta ?? 0),
      revenue: Number(prevAgg._sum.revenue ?? 0),
    };

    return ok({
      period,
      groupId: groupId ?? null,
      channelCount: channelIds.length,
      dateRange: {
        current: { from: isoDate(curFrom), to: isoDate(curTo) },
        previous: { from: isoDate(prevFrom), to: isoDate(prevTo) },
      },
      metrics: {
        views: delta(cur.views, prev.views),
        watchTimeHours: delta(cur.watchTimeHours, prev.watchTimeHours),
        subscribersGained: delta(cur.subscribersGained, prev.subscribersGained),
        revenue: delta(cur.revenue, prev.revenue),
      },
    });
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
