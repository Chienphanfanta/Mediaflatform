// GET /api/v1/analytics/summary?period=30d&groupId?&from?&to?
// Gom tất cả data cần cho trang /analytics vào 1 response.
// Scope channels theo user.groups (SuperAdmin thấy all). Nếu groupId → verify membership.
import { Prisma, type Platform } from '@prisma/client';
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
  subDays,
} from 'date-fns';

import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { summaryQuerySchema } from '@/lib/schemas/analytics';
import type {
  AnalyticsSummaryResponse,
  PlatformBreakdownItem,
} from '@/lib/types/analytics-summary';

const PLATFORMS: Platform[] = [
  'YOUTUBE',
  'FACEBOOK',
  'INSTAGRAM',
  'X',
  'TELEGRAM',
  'WHATSAPP',
];

const PLATFORM_COLORS: Record<Platform, string> = {
  YOUTUBE: '#FF0000',
  FACEBOOK: '#1877F2',
  INSTAGRAM: '#E1306C',
  X: '#0F172A',
  TELEGRAM: '#8B5CF6', // tím theo user spec (thay màu mặc định Telegram blue)
  WHATSAPP: '#25D366',
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function fillDailyLabels(from: Date, to: Date): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to) {
    out.push(isoDate(d));
    d = addDays(d, 1);
  }
  return out;
}

function delta(cur: number, prev: number) {
  const d = cur - prev;
  return {
    current: r2(cur),
    previous: r2(prev),
    delta: r2(d),
    deltaPct: prev > 0 ? r2((d / prev) * 100) : null,
  };
}

export const GET = withAuth(
  async ({ req, user }) => {
    const url = new URL(req.url);
    const parsed = summaryQuerySchema.safeParse({
      period: url.searchParams.get('period') ?? undefined,
      groupId: url.searchParams.get('groupId') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    });
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Query không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { period, groupId, from, to } = parsed.data;

    // Determine range
    const useCustom = !!(from && to);
    const now = new Date();
    const curTo = useCustom ? startOfDay(to!) : startOfDay(now);
    const periodDays = useCustom
      ? differenceInCalendarDays(curTo, startOfDay(from!)) + 1
      : { '7d': 7, '30d': 30, '90d': 90 }[period];
    const curFrom = useCustom ? startOfDay(from!) : subDays(curTo, periodDays - 1);
    const prevTo = subDays(curFrom, 1);
    const prevFrom = subDays(prevTo, periodDays - 1);

    // Scope channels
    const userGroupIds = user.groups.map((g) => g.id);
    const channelWhere: Prisma.ChannelWhereInput = { deletedAt: null };

    if (groupId) {
      if (!user.isSuperAdmin && !userGroupIds.includes(groupId)) {
        return fail('FORBIDDEN', 'Bạn không thuộc group này', { status: 403 });
      }
      channelWhere.groups = { some: { groupId } };
    } else if (!user.isSuperAdmin) {
      channelWhere.groups = { some: { groupId: { in: userGroupIds } } };
    }

    const channels = await prisma.channel.findMany({
      where: channelWhere,
      select: { id: true, platform: true },
    });
    const channelIds = channels.map((c) => c.id);

    const emptyResponse: AnalyticsSummaryResponse = {
      period: useCustom ? 'custom' : period,
      groupId: groupId ?? null,
      channelCount: 0,
      dateRange: {
        current: { from: isoDate(curFrom), to: isoDate(curTo) },
        previous: { from: isoDate(prevFrom), to: isoDate(prevTo) },
        days: periodDays,
      },
      kpi: {
        views: { current: 0, previous: 0, delta: 0, deltaPct: null, sparkline: [] },
        watchTimeHours: {
          current: 0,
          previous: 0,
          delta: 0,
          deltaPct: null,
          yearlyEstimate: 0,
          progressPct: 0,
          threshold: 4000,
        },
        subscribersGained: {
          current: 0,
          previous: 0,
          delta: 0,
          deltaPct: null,
          sparkline: [],
        },
        engagementRate: { current: 0, previous: 0, delta: 0, deltaPct: null },
        revenue: { current: 0, previous: 0, delta: 0, deltaPct: null, currency: 'USD' },
      },
      viewsByPlatformDaily: { labels: [], datasets: [] },
      platformBreakdown: [],
    };

    if (channelIds.length === 0) return ok(emptyResponse);

    const sumSelect = {
      views: true,
      watchTimeHours: true,
      subscriberDelta: true,
      revenue: true,
    } as const;

    // 3 queries parallel — V2: bỏ post.groupBy + post.findMany (Post entity không còn)
    const [curAgg, prevAgg, curRows] = await Promise.all([
      prisma.analytics.aggregate({
        where: { channelId: { in: channelIds }, date: { gte: curFrom, lte: curTo } },
        _sum: sumSelect,
        _avg: { engagementRate: true },
      }),
      prisma.analytics.aggregate({
        where: { channelId: { in: channelIds }, date: { gte: prevFrom, lte: prevTo } },
        _sum: sumSelect,
        _avg: { engagementRate: true },
      }),
      prisma.analytics.findMany({
        where: { channelId: { in: channelIds }, date: { gte: curFrom, lte: curTo } },
        orderBy: { date: 'asc' },
        select: {
          date: true,
          platform: true,
          views: true,
          watchTimeHours: true,
          subscriberDelta: true,
          engagementRate: true,
        },
      }),
    ]);

    // Views-by-platform-daily
    const labels = fillDailyLabels(curFrom, curTo);
    const labelIdx = new Map(labels.map((l, i) => [l, i]));
    const platformSeries = new Map<Platform, number[]>(
      PLATFORMS.map((p) => [p, new Array(labels.length).fill(0)]),
    );
    // Platform breakdown accumulator
    type Agg = { views: number; wt: number; engSum: number; engCount: number };
    const platformAgg = new Map<Platform, Agg>();

    for (const r of curRows) {
      const i = labelIdx.get(isoDate(r.date));
      if (i !== undefined) {
        const arr = platformSeries.get(r.platform);
        if (arr) arr[i] += r.views;
      }
      const a = platformAgg.get(r.platform) ?? {
        views: 0,
        wt: 0,
        engSum: 0,
        engCount: 0,
      };
      a.views += r.views;
      a.wt += r.watchTimeHours;
      a.engSum += r.engagementRate;
      a.engCount += 1;
      platformAgg.set(r.platform, a);
    }

    const viewsByPlatformDaily = {
      labels,
      datasets: PLATFORMS.filter((p) => (platformSeries.get(p) ?? []).some((v) => v > 0))
        .map((p) => ({
          label: p,
          data: platformSeries.get(p)!,
          color: PLATFORM_COLORS[p],
        })),
    };

    // Platform breakdown — sort theo views desc
    const totalViews = Number(curAgg._sum.views ?? 0);
    const platformBreakdown: PlatformBreakdownItem[] = Array.from(platformAgg.entries())
      .map(([platform, a]) => ({
        platform,
        views: a.views,
        watchTimeHours: r2(a.wt),
        avgEngagement: r2(a.engCount ? a.engSum / a.engCount : 0),
        viewsSharePct: totalViews > 0 ? r2((a.views / totalViews) * 100) : 0,
      }))
      .sort((a, b) => b.views - a.views);

    // Sparkline: 7 điểm cuối của period (hoặc ít hơn nếu period < 7d)
    const sparkLen = Math.min(7, labels.length);
    const sparkStart = labels.length - sparkLen;
    const viewsSparkline = new Array(sparkLen).fill(0);
    const subsSparkline = new Array(sparkLen).fill(0);
    for (const r of curRows) {
      const i = labelIdx.get(isoDate(r.date));
      if (i === undefined || i < sparkStart) continue;
      const j = i - sparkStart;
      viewsSparkline[j] += r.views;
      subsSparkline[j] += r.subscriberDelta;
    }

    // KPI
    const curViews = Number(curAgg._sum.views ?? 0);
    const prevViews = Number(prevAgg._sum.views ?? 0);
    const curWt = Number(curAgg._sum.watchTimeHours ?? 0);
    const prevWt = Number(prevAgg._sum.watchTimeHours ?? 0);
    const curSubs = Number(curAgg._sum.subscriberDelta ?? 0);
    const prevSubs = Number(prevAgg._sum.subscriberDelta ?? 0);
    const curRev = Number(curAgg._sum.revenue ?? 0);
    const prevRev = Number(prevAgg._sum.revenue ?? 0);
    const curEng = Number(curAgg._avg.engagementRate ?? 0);
    const prevEng = Number(prevAgg._avg.engagementRate ?? 0);

    const yearlyEstimate = periodDays > 0 ? (curWt * 365) / periodDays : 0;
    const progressPct = r2((yearlyEstimate / 4000) * 100);

    const body: AnalyticsSummaryResponse = {
      period: useCustom ? 'custom' : period,
      groupId: groupId ?? null,
      channelCount: channelIds.length,
      dateRange: {
        current: { from: isoDate(curFrom), to: isoDate(curTo) },
        previous: { from: isoDate(prevFrom), to: isoDate(prevTo) },
        days: periodDays,
      },
      kpi: {
        views: { ...delta(curViews, prevViews), sparkline: viewsSparkline },
        watchTimeHours: {
          ...delta(curWt, prevWt),
          yearlyEstimate: r2(yearlyEstimate),
          progressPct,
          threshold: 4000,
        },
        subscribersGained: { ...delta(curSubs, prevSubs), sparkline: subsSparkline },
        engagementRate: delta(curEng, prevEng),
        revenue: { ...delta(curRev, prevRev), currency: 'USD' },
      },
      viewsByPlatformDaily,
      platformBreakdown,
    };

    return ok(body);
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
