// GET /api/v1/analytics/channels/:id/detail?period=30d
// Gom data cho 3 tab: Overview / Monetization / So sánh.
// Posts tab có endpoint riêng (/posts) vì cần pagination + filter.
import { Prisma } from '@prisma/client';
import { addDays, format, startOfDay, subDays, subMonths } from 'date-fns';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import type {
  ChannelDetailResponse,
  Milestone,
  MonetizationData,
  MonetizationStatus,
  PeriodAgg,
  ViolationItem,
} from '@/lib/types/channel-detail';

const querySchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
});

const SUB_MILESTONES = [1_000, 10_000, 100_000, 1_000_000, 10_000_000];

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

function milestoneLabel(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M subs`;
  if (n >= 1_000) return `${n / 1_000}K subs`;
  return `${n} subs`;
}

function calcScore(
  curViews: number,
  prevViews: number,
  avgEngagement: number,
  daysWithActivity: number,
  totalDays: number,
) {
  // Growth (0-40): -100% → 0, 0% → 20, +100% → 40 (cap)
  const growthPct = prevViews > 0 ? (curViews - prevViews) / prevViews : 0;
  const growth = Math.max(0, Math.min(40, 20 + growthPct * 20));

  // Engagement (0-30): 0% → 0, 10% → 30 (cap)
  const engagement = Math.min(30, Math.max(0, avgEngagement * 3));

  // Consistency (0-30): tỷ lệ ngày có view > 0
  const consistency = totalDays > 0 ? (daysWithActivity / totalDays) * 30 : 0;

  return {
    total: Math.round(growth + engagement + consistency),
    breakdown: {
      growth: Math.round(growth),
      engagement: Math.round(engagement),
      consistency: Math.round(consistency),
    },
    max: { growth: 40 as const, engagement: 30 as const, consistency: 30 as const },
  };
}

export const GET = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      period: url.searchParams.get('period') ?? undefined,
    });
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Query không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { period } = parsed.data;

    // Access check
    const channelWhere: Prisma.ChannelWhereInput = user.isSuperAdmin
      ? { id: params.id, deletedAt: null }
      : {
          id: params.id,
          deletedAt: null,
          groups: { some: { groupId: { in: user.groups.map((g) => g.id) } } },
        };

    const channel = await prisma.channel.findFirst({
      where: channelWhere,
      select: { id: true, name: true, platform: true, status: true, metadata: true },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh hoặc không có quyền', {
        status: 404,
      });
    }

    const meta = (channel.metadata as Record<string, unknown> | null) ?? null;
    const monetizationEnabled = Boolean(meta?.monetizationEnabled);

    const days = { '7d': 7, '30d': 30, '90d': 90 }[period];
    const now = new Date();
    const curTo = startOfDay(now);
    const curFrom = subDays(curTo, days - 1);
    const prevTo = subDays(curFrom, 1);
    const prevFrom = subDays(prevTo, days - 1);
    const monthlyFrom = startOfDay(subMonths(curTo, 5)); // 6 tháng cho monthly revenue chart

    const [curRows, prevRows, violations, monthlyRows] = await Promise.all([
      prisma.analytics.findMany({
        where: { channelId: params.id, date: { gte: curFrom, lte: curTo } },
        orderBy: { date: 'asc' },
        select: {
          date: true,
          views: true,
          watchTimeHours: true,
          subscribers: true,
          subscriberDelta: true,
          revenue: true,
          engagementRate: true,
        },
      }),
      prisma.analytics.findMany({
        where: { channelId: params.id, date: { gte: prevFrom, lte: prevTo } },
        orderBy: { date: 'asc' },
        select: {
          date: true,
          views: true,
          subscriberDelta: true,
          revenue: true,
          engagementRate: true,
        },
      }),
      prisma.alert.findMany({
        where: { channelId: params.id, type: 'POLICY_VIOLATION' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          message: true,
          severity: true,
          createdAt: true,
          metadata: true,
        },
      }),
      channel.platform === 'YOUTUBE'
        ? prisma.analytics.findMany({
            where: { channelId: params.id, date: { gte: monthlyFrom, lte: curTo } },
            select: { date: true, revenue: true },
          })
        : Promise.resolve([] as Array<{ date: Date; revenue: number }>),
    ]);

    // Build overview labels + arrays
    const labels = fillDailyLabels(curFrom, curTo);
    const labelIdx = new Map(labels.map((l, i) => [l, i]));
    const z0 = () => new Array(labels.length).fill(0);
    const oViews = z0();
    const oWt = z0();
    const oSubs = z0();
    const oSubsDelta = z0();
    const oRev = z0();

    for (const r of curRows) {
      const i = labelIdx.get(isoDate(r.date));
      if (i === undefined) continue;
      oViews[i] = r.views;
      oWt[i] = r.watchTimeHours;
      oSubs[i] = r.subscribers;
      oSubsDelta[i] = r.subscriberDelta;
      oRev[i] = r.revenue;
    }

    // Detect milestone crossings
    const milestones: Milestone[] = [];
    let lastSubs = oSubs[0] ?? 0;
    for (let i = 1; i < oSubs.length; i++) {
      const cur = oSubs[i];
      for (const t of SUB_MILESTONES) {
        if (lastSubs < t && cur >= t) {
          milestones.push({ date: labels[i], value: t, label: milestoneLabel(t) });
        }
      }
      lastSubs = cur || lastSubs; // skip 0 days (chưa có data)
    }

    // Aggregate current period
    const curViewsTotal = curRows.reduce((s, r) => s + r.views, 0);
    const curWtTotal = curRows.reduce((s, r) => s + r.watchTimeHours, 0);
    const curSubsTotal = curRows.reduce((s, r) => s + r.subscriberDelta, 0);
    const curRevTotal = curRows.reduce((s, r) => s + r.revenue, 0);
    const curEngAvg =
      curRows.length > 0
        ? curRows.reduce((s, r) => s + r.engagementRate, 0) / curRows.length
        : 0;
    const daysWithViews = curRows.filter((r) => r.views > 0).length;

    // Aggregate previous period
    const prevViewsTotal = prevRows.reduce((s, r) => s + r.views, 0);
    const prevSubsTotal = prevRows.reduce((s, r) => s + r.subscriberDelta, 0);
    const prevRevTotal = prevRows.reduce((s, r) => s + r.revenue, 0);
    const prevEngAvg =
      prevRows.length > 0
        ? prevRows.reduce((s, r) => s + r.engagementRate, 0) / prevRows.length
        : 0;

    // Build daily arrays length=days for comparison chart
    const buildDaily = (rows: Array<{ date: Date; views: number }>, from: Date) => {
      const out = new Array(days).fill(0);
      const idx = new Map<string, number>();
      for (let i = 0; i < days; i++) idx.set(isoDate(addDays(from, i)), i);
      for (const r of rows) {
        const i = idx.get(isoDate(r.date));
        if (i !== undefined) out[i] = r.views;
      }
      return out;
    };

    const currentAgg: PeriodAgg = {
      from: isoDate(curFrom),
      to: isoDate(curTo),
      totalViews: curViewsTotal,
      totalSubscribers: curSubsTotal,
      totalRevenue: r2(curRevTotal),
      avgEngagement: r2(curEngAvg),
      daily: buildDaily(curRows, curFrom),
    };
    const previousAgg: PeriodAgg = {
      from: isoDate(prevFrom),
      to: isoDate(prevTo),
      totalViews: prevViewsTotal,
      totalSubscribers: prevSubsTotal,
      totalRevenue: r2(prevRevTotal),
      avgEngagement: r2(prevEngAvg),
      daily: buildDaily(
        prevRows as Array<{ date: Date; views: number }>,
        prevFrom,
      ),
    };

    const score = calcScore(
      curViewsTotal,
      prevViewsTotal,
      curEngAvg,
      daysWithViews,
      days,
    );

    // Monetization (YouTube only)
    let monetization: MonetizationData | null = null;
    if (channel.platform === 'YOUTUBE') {
      const yearlyEstimate = days > 0 ? (curWtTotal * 365) / days : 0;
      const latestSubs = curRows[curRows.length - 1]?.subscribers ?? Number(meta?.subscriberCount ?? 0);

      let status: MonetizationStatus = 'NOT_MONETIZED';
      if (monetizationEnabled) status = 'APPROVED';
      else if (yearlyEstimate >= 4000 && latestSubs >= 1000) status = 'UNDER_REVIEW';

      // Group monthly revenue
      const monthlyMap = new Map<string, number>();
      for (const r of monthlyRows) {
        const k = format(r.date, 'yyyy-MM');
        monthlyMap.set(k, (monthlyMap.get(k) ?? 0) + r.revenue);
      }
      const monthLabels: string[] = [];
      const monthData: number[] = [];
      for (let i = 5; i >= 0; i--) {
        const m = format(subMonths(curTo, i), 'yyyy-MM');
        monthLabels.push(m);
        monthData.push(r2(monthlyMap.get(m) ?? 0));
      }

      const violationsOut: ViolationItem[] = violations.map((v) => ({
        id: v.id,
        message: v.message,
        severity: v.severity,
        createdAt: v.createdAt.toISOString(),
        metadata: (v.metadata as Record<string, unknown> | null) ?? null,
      }));

      monetization = {
        status,
        watchTimeYearlyHours: r2(yearlyEstimate),
        watchTimeThreshold: 4000,
        watchTimeProgressPct: r2((yearlyEstimate / 4000) * 100),
        subscribersCount: latestSubs,
        subscribersThreshold: 1000,
        subscribersProgressPct: r2((latestSubs / 1000) * 100),
        violations: violationsOut,
        monthlyRevenue: { labels: monthLabels, data: monthData },
      };
    }

    const body: ChannelDetailResponse = {
      channel: {
        id: channel.id,
        name: channel.name,
        platform: channel.platform,
        status: channel.status,
        monetizationEnabled,
        subscriberCount:
          (curRows[curRows.length - 1]?.subscribers ?? Number(meta?.subscriberCount ?? null)) || null,
        metadata: meta,
      },
      period,
      overview: {
        labels,
        views: oViews,
        watchTimeHours: oWt.map((v) => r2(v)),
        subscribers: oSubs,
        subscriberDelta: oSubsDelta,
        revenue: oRev.map((v) => r2(v)),
        milestones,
      },
      monetization,
      comparison: { period, days, current: currentAgg, previous: previousAgg, score },
    };

    return ok(body);
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
