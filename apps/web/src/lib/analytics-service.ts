// Analytics Service — tổng hợp dữ liệu từ bảng `Analytics` (và `Post` cho top posts).
// SERVER-ONLY: gọi từ API route handler hoặc server component.
//
// Cache: Redis TTL — metrics 1h, top posts 30min, revenue 6h, growth 1h.
// Graceful fallback: Redis không có/xuống → query trực tiếp DB (xem lib/redis.ts).
//
// Format output: `{ labels, datasets }` tương thích Chart.js / có helper `toRechartsData()`
// để convert sang shape Recharts cần.
//
// ⚠ PostAnalytics schema hiện chưa populate (KNOWN ISSUE #4–5) → getTopPosts dùng
// synth score deterministic để chart có dữ liệu hiển thị. Thay bằng aggregation
// PostAnalytics thật khi có tracking per-post.

import { Prisma, type Platform } from '@prisma/client';
import {
  addDays,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns';

import { prisma } from './prisma';
import { cached } from './redis';

// ============================================================
// TYPES
// ============================================================

export type PeriodKey = '7d' | '30d' | '90d';

export type MetricKey =
  | 'views'
  | 'watchTimeHours'
  | 'subscribers'
  | 'revenue'
  | 'engagement'
  | 'impressions'
  | 'clicks';

export type SortKey = 'views' | 'engagement' | 'revenue';

export type DateRange = { from: Date; to: Date };

/** Chart.js-style dataset. Dùng `toRechartsData()` nếu caller cần Recharts shape. */
export type ChartDataset = {
  label: string;
  data: number[];
  color?: string;
};

export type ChartData = {
  labels: string[];
  datasets: ChartDataset[];
};

export type TopPostItem = {
  id: string;
  title: string;
  platform: Platform;
  channelId: string;
  channelName: string;
  publishedAt: string | null;
  views: number;
  engagement: number; // 0–100 %
  revenue: number; // USD
};

export type TopPostsResult = {
  posts: TopPostItem[];
  meta: {
    sortBy: SortKey;
    limit: number;
    /** `false` khi fallback sang synth score (xem KNOWN ISSUE #5). */
    hasAnalyticsData: boolean;
  };
};

export type GrowthRateResult = {
  metric: MetricKey;
  period: PeriodKey;
  current: number;
  previous: number;
  delta: number;
  /** null khi `previous === 0` (tránh chia cho 0). */
  deltaPct: number | null;
  currentRange: { from: string; to: string };
  previousRange: { from: string; to: string };
};

export type WatchTimeReport = ChartData & {
  totalHours: number;
  /** YouTube monetization threshold — so sánh trực tiếp với `totalHours * 12` để ước tính năm. */
  ytThresholdHours: 4000;
  progressPct: number;
};

export type RevenueEstimateResult = {
  channelId: string;
  period: PeriodKey;
  totalRevenue: number;
  averageDailyRevenue: number;
  estimatedMonthlyRevenue: number;
  breakdown: ChartData;
  currency: 'USD';
  confidence: 'high' | 'medium' | 'low';
  note: string;
};

// ============================================================
// CONSTANTS
// ============================================================

const CACHE_VERSION = 'v1';
const CACHE_PREFIX = `media-ops:${CACHE_VERSION}:analytics`;

const TTL = {
  METRICS: 60 * 60, // 1h
  TOP_POSTS: 30 * 60, // 30 phút
  REVENUE: 6 * 60 * 60, // 6h
  GROWTH: 60 * 60, // 1h
} as const;

const PLATFORM_COLORS: Record<Platform, string> = {
  YOUTUBE: '#FF0000',
  FACEBOOK: '#1877F2',
  INSTAGRAM: '#E1306C',
  X: '#0F172A',
  TELEGRAM: '#229ED9',
  WHATSAPP: '#25D366',
};

const METRIC_FIELD: Record<MetricKey, string> = {
  views: 'views',
  watchTimeHours: 'watchTimeHours',
  subscribers: 'subscriberDelta', // tăng trưởng = delta, không phải absolute
  revenue: 'revenue',
  engagement: 'engagementRate',
  impressions: 'impressions',
  clicks: 'clicks',
};

// ============================================================
// HELPERS
// ============================================================

function periodToDays(p: PeriodKey): number {
  return { '7d': 7, '30d': 30, '90d': 90 }[p];
}

function rangeFromPeriod(p: PeriodKey, now: Date = new Date()): DateRange {
  const to = startOfDay(now);
  const from = subDays(to, periodToDays(p) - 1);
  return { from, to };
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

function indexByLabel(labels: string[]): Map<string, number> {
  return new Map(labels.map((l, i) => [l, i]));
}

function cacheKey(parts: Array<string | number | string[] | null | undefined>): string {
  const normalized = parts.map((p) => {
    if (p === null || p === undefined) return '';
    if (Array.isArray(p)) return p.slice().sort().join(',');
    return String(p);
  });
  return [CACHE_PREFIX, ...normalized].join(':');
}

/** Round 2 chữ số thập phân. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Synth score deterministic cho TopPosts khi PostAnalytics rỗng (xem KNOWN ISSUE #5).
// TODO: thay bằng aggregate PostAnalytics khi có tracking per-post.
function synthScore(id: string, salt: string): number {
  let h = 2166136261;
  for (const ch of id + salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h);
}

// ============================================================
// CONVERTER — ChartData → Recharts shape
// ============================================================

/**
 * Convert `{ labels, datasets }` → `Array<{ name, [datasetLabel]: value }>` cho Recharts.
 *
 * @example
 *   const data = toRechartsData(await getChannelMetrics(id, range));
 *   <LineChart data={data}><Line dataKey="Views" /></LineChart>
 */
export function toRechartsData(chart: ChartData): Array<Record<string, string | number>> {
  return chart.labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label };
    for (const ds of chart.datasets) {
      row[ds.label] = ds.data[i] ?? 0;
    }
    return row;
  });
}

// ============================================================
// 1. getChannelMetrics — daily metrics cho 1 channel
// ============================================================

export async function getChannelMetrics(
  channelId: string,
  dateRange: DateRange,
): Promise<ChartData> {
  const from = startOfDay(dateRange.from);
  const to = startOfDay(dateRange.to);
  if (from > to) return { labels: [], datasets: [] };

  return cached(
    cacheKey(['chan-metrics', channelId, isoDate(from), isoDate(to)]),
    TTL.METRICS,
    async () => {
      const rows = await prisma.analytics.findMany({
        where: {
          channelId,
          date: { gte: from, lte: endOfDay(to) },
        },
        orderBy: { date: 'asc' },
        select: {
          date: true,
          views: true,
          watchTimeHours: true,
          subscribers: true,
          subscriberDelta: true,
          revenue: true,
          engagementRate: true,
          impressions: true,
          clicks: true,
        },
      });

      const labels = fillDailyLabels(from, to);
      const idx = indexByLabel(labels);
      const zeros = () => new Array(labels.length).fill(0);

      const views = zeros();
      const watchTime = zeros();
      const subs = zeros();
      const revenue = zeros();
      const engagement = zeros();
      const impressions = zeros();
      const clicks = zeros();

      for (const row of rows) {
        const i = idx.get(isoDate(row.date));
        if (i === undefined) continue;
        views[i] = row.views;
        watchTime[i] = row.watchTimeHours;
        subs[i] = row.subscribers;
        revenue[i] = row.revenue;
        engagement[i] = row.engagementRate;
        impressions[i] = row.impressions;
        clicks[i] = row.clicks;
      }

      return {
        labels,
        datasets: [
          { label: 'Views', data: views, color: '#3b82f6' },
          { label: 'Watch Time (h)', data: watchTime, color: '#8b5cf6' },
          { label: 'Subscribers', data: subs, color: '#10b981' },
          { label: 'Revenue ($)', data: revenue, color: '#f59e0b' },
          { label: 'Engagement %', data: engagement, color: '#ec4899' },
          { label: 'Impressions', data: impressions, color: '#06b6d4' },
          { label: 'Clicks', data: clicks, color: '#6366f1' },
        ],
      };
    },
  );
}

// ============================================================
// 2. getMultiChannelOverview — views của nhiều channel theo ngày
// ============================================================

export async function getMultiChannelOverview(
  channelIds: string[],
  period: PeriodKey,
): Promise<ChartData> {
  if (channelIds.length === 0) return { labels: [], datasets: [] };

  return cached(
    cacheKey(['multi-overview', channelIds, period]),
    TTL.METRICS,
    async () => {
      const { from, to } = rangeFromPeriod(period);

      const [rows, channels] = await Promise.all([
        prisma.analytics.findMany({
          where: {
            channelId: { in: channelIds },
            date: { gte: from, lte: to },
          },
          orderBy: { date: 'asc' },
          select: { channelId: true, date: true, views: true },
        }),
        prisma.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, name: true, platform: true },
        }),
      ]);

      const labels = fillDailyLabels(from, to);
      const labelIdx = indexByLabel(labels);

      const datasets: ChartDataset[] = channels.map((c) => ({
        label: c.name,
        data: new Array(labels.length).fill(0),
        color: PLATFORM_COLORS[c.platform],
      }));
      const chanIdx = new Map(channels.map((c, i) => [c.id, i]));

      for (const row of rows) {
        const i = labelIdx.get(isoDate(row.date));
        const j = chanIdx.get(row.channelId);
        if (i === undefined || j === undefined) continue;
        datasets[j].data[i] += row.views;
      }

      return { labels, datasets };
    },
  );
}

// ============================================================
// 3. getPlatformBreakdown — so sánh các platform trong 1 group
// ============================================================

export async function getPlatformBreakdown(
  groupId: string,
  period: PeriodKey,
): Promise<ChartData> {
  return cached(
    cacheKey(['platform-breakdown', groupId, period]),
    TTL.METRICS,
    async () => {
      const { from, to } = rangeFromPeriod(period);

      const channels = await prisma.channel.findMany({
        where: {
          deletedAt: null,
          groups: { some: { groupId } },
        },
        select: { id: true, platform: true },
      });
      if (channels.length === 0) return { labels: [], datasets: [] };

      const channelIds = channels.map((c) => c.id);

      const rows = await prisma.analytics.findMany({
        where: {
          channelId: { in: channelIds },
          date: { gte: from, lte: to },
        },
        select: {
          platform: true,
          views: true,
          watchTimeHours: true,
          revenue: true,
          engagementRate: true,
        },
      });

      type Agg = { views: number; wt: number; revenue: number; engSum: number; engCount: number };
      const byPlatform = new Map<Platform, Agg>();
      for (const r of rows) {
        const cur =
          byPlatform.get(r.platform) ??
          { views: 0, wt: 0, revenue: 0, engSum: 0, engCount: 0 };
        cur.views += r.views;
        cur.wt += r.watchTimeHours;
        cur.revenue += r.revenue;
        cur.engSum += r.engagementRate;
        cur.engCount += 1;
        byPlatform.set(r.platform, cur);
      }

      const labels = Array.from(byPlatform.keys()).sort() as Platform[];
      const viewsData: number[] = [];
      const wtData: number[] = [];
      const revData: number[] = [];
      const engData: number[] = [];
      for (const p of labels) {
        const a = byPlatform.get(p)!;
        viewsData.push(a.views);
        wtData.push(r2(a.wt));
        revData.push(r2(a.revenue));
        engData.push(r2(a.engCount ? a.engSum / a.engCount : 0));
      }

      return {
        labels,
        datasets: [
          { label: 'Views', data: viewsData, color: '#3b82f6' },
          { label: 'Watch Time (h)', data: wtData, color: '#8b5cf6' },
          { label: 'Revenue ($)', data: revData, color: '#f59e0b' },
          { label: 'Avg Engagement %', data: engData, color: '#ec4899' },
        ],
      };
    },
  );
}

// ============================================================
// 4. getTopPosts — V2 STUB (Post entity bỏ).
// Sprint 6 sẽ thay bằng "top channels by KPI achievement" hoặc xoá hoàn toàn.
// ============================================================

export async function getTopPosts(
  _channelId: string,
  limit: number,
  sortBy: SortKey = 'views',
  _period: PeriodKey = '30d',
): Promise<TopPostsResult> {
  const lim = Math.min(Math.max(1, Math.floor(limit)), 50);
  return {
    posts: [],
    meta: { sortBy, limit: lim, hasAnalyticsData: false },
  };
}

// ============================================================
// 5. getGrowthRate — % tăng trưởng kỳ này vs kỳ trước
// ============================================================

export async function getGrowthRate(
  channelId: string,
  metric: MetricKey,
  period: PeriodKey,
): Promise<GrowthRateResult> {
  return cached(
    cacheKey(['growth', channelId, metric, period]),
    TTL.GROWTH,
    async () => {
      const days = periodToDays(period);
      const now = new Date();
      const curTo = startOfDay(now);
      const curFrom = subDays(curTo, days - 1);
      const prevTo = subDays(curFrom, 1);
      const prevFrom = subDays(prevTo, days - 1);

      const [current, previous] = await Promise.all([
        aggregateMetric(channelId, metric, curFrom, curTo),
        aggregateMetric(channelId, metric, prevFrom, prevTo),
      ]);

      const delta = current - previous;
      const deltaPct = previous > 0 ? r2((delta / previous) * 100) : null;

      return {
        metric,
        period,
        current: r2(current),
        previous: r2(previous),
        delta: r2(delta),
        deltaPct,
        currentRange: { from: isoDate(curFrom), to: isoDate(curTo) },
        previousRange: { from: isoDate(prevFrom), to: isoDate(prevTo) },
      };
    },
  );
}

async function aggregateMetric(
  channelId: string,
  metric: MetricKey,
  from: Date,
  to: Date,
): Promise<number> {
  const field = METRIC_FIELD[metric];

  // Engagement là tỷ lệ → tính AVG, không SUM
  if (metric === 'engagement') {
    const res = await prisma.analytics.aggregate({
      where: { channelId, date: { gte: from, lte: to } },
      _avg: { engagementRate: true },
    });
    return Number(res._avg.engagementRate ?? 0);
  }

  const res = await prisma.analytics.aggregate({
    where: { channelId, date: { gte: from, lte: to } },
    _sum: { [field]: true } as Prisma.AnalyticsSumAggregateInputType,
  });
  return Number((res._sum as Record<string, number | null>)[field] ?? 0);
}

// ============================================================
// 6. getWatchTimeReport — watch time tổng hợp theo tháng
// ============================================================

/**
 * Báo cáo giờ xem tháng. Quan trọng cho YouTube monetization:
 * yêu cầu ≥ 4,000 giờ xem công khai trong 12 tháng gần nhất.
 * Trả `progressPct` = (tổng giờ tháng này × 12) / 4000 × 100 để ước tính năm.
 */
export async function getWatchTimeReport(
  channelIds: string[],
  month: Date,
): Promise<WatchTimeReport> {
  if (channelIds.length === 0) {
    return {
      labels: [],
      datasets: [],
      totalHours: 0,
      ytThresholdHours: 4000,
      progressPct: 0,
    };
  }

  return cached(
    cacheKey(['watchtime', channelIds, isoDate(startOfMonth(month))]),
    TTL.METRICS,
    async () => {
      const from = startOfMonth(month);
      const to = endOfMonth(month);

      const [rows, channels] = await Promise.all([
        prisma.analytics.findMany({
          where: {
            channelId: { in: channelIds },
            date: { gte: from, lte: to },
          },
          select: { channelId: true, date: true, watchTimeHours: true },
        }),
        prisma.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, name: true, platform: true },
        }),
      ]);

      const labels = fillDailyLabels(from, to);
      const labelIdx = indexByLabel(labels);

      const datasets: ChartDataset[] = channels.map((c) => ({
        label: c.name,
        data: new Array(labels.length).fill(0),
        color: PLATFORM_COLORS[c.platform],
      }));
      const chanIdx = new Map(channels.map((c, i) => [c.id, i]));

      let totalHours = 0;
      for (const r of rows) {
        const i = labelIdx.get(isoDate(r.date));
        const j = chanIdx.get(r.channelId);
        if (i === undefined || j === undefined) continue;
        datasets[j].data[i] = r2(datasets[j].data[i] + r.watchTimeHours);
        totalHours += r.watchTimeHours;
      }

      const yearlyEstimate = totalHours * 12;
      const progressPct = r2((yearlyEstimate / 4000) * 100);

      return {
        labels,
        datasets,
        totalHours: r2(totalHours),
        ytThresholdHours: 4000 as const,
        progressPct,
      };
    },
  );
}

// ============================================================
// 7. getRevenueEstimate — ước tính doanh thu AdSense
// ============================================================

export async function getRevenueEstimate(
  channelId: string,
  period: PeriodKey,
): Promise<RevenueEstimateResult> {
  return cached(
    cacheKey(['revenue', channelId, period]),
    TTL.REVENUE,
    async () => {
      const { from, to } = rangeFromPeriod(period);

      const rows = await prisma.analytics.findMany({
        where: { channelId, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' },
        select: { date: true, revenue: true },
      });

      const labels = fillDailyLabels(from, to);
      const labelIdx = indexByLabel(labels);
      const data = new Array(labels.length).fill(0);

      let total = 0;
      let filledDays = 0;
      for (const row of rows) {
        const i = labelIdx.get(isoDate(row.date));
        if (i === undefined) continue;
        data[i] = r2(row.revenue);
        total += row.revenue;
        if (row.revenue > 0) filledDays++;
      }

      const days = periodToDays(period);
      const avgDaily = total / days;
      const monthly = avgDaily * 30;
      const density = days > 0 ? filledDays / days : 0;

      const confidence: RevenueEstimateResult['confidence'] =
        density >= 0.8 ? 'high' : density >= 0.4 ? 'medium' : 'low';

      const note =
        confidence === 'low'
          ? `Dữ liệu thưa (${filledDays}/${days} ngày có revenue) — ước tính chỉ tham khảo.`
          : `Tính trên ${filledDays}/${days} ngày có revenue snapshot.`;

      return {
        channelId,
        period,
        totalRevenue: r2(total),
        averageDailyRevenue: r2(avgDaily),
        estimatedMonthlyRevenue: r2(monthly),
        breakdown: {
          labels,
          datasets: [{ label: 'Daily Revenue ($)', data, color: '#f59e0b' }],
        },
        currency: 'USD',
        confidence,
        note,
      };
    },
  );
}
