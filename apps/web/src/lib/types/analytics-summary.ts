// Response shape cho GET /api/v1/analytics/summary — dùng chung BE + FE.
import type { Platform } from '@prisma/client';

export type DeltaMetric = {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
};

export type ViewsKpi = DeltaMetric & {
  /** Giá trị 7 ngày gần nhất của khoảng hiện tại, cho sparkline mini chart. */
  sparkline: number[];
};

export type WatchTimeKpi = DeltaMetric & {
  /** Ước tính năm = current × (365 / periodDays), progress vs 4000h. */
  yearlyEstimate: number;
  progressPct: number;
  threshold: 4000;
};

export type SubscribersKpi = DeltaMetric & { sparkline: number[] };

export type RevenueKpi = DeltaMetric & { currency: 'USD' };

export type PlatformBreakdownItem = {
  platform: Platform;
  views: number;
  watchTimeHours: number;
  // V1 postCount removed
  avgEngagement: number;
  viewsSharePct: number;
};

export type ViewsByPlatformDaily = {
  labels: string[]; // YYYY-MM-DD
  datasets: Array<{
    label: Platform;
    data: number[];
    color: string;
  }>;
};

// V1 AnalyticsTopPost removed — Post entity không còn.

export type AnalyticsSummaryResponse = {
  period: '7d' | '30d' | '90d' | 'custom';
  groupId: string | null;
  channelCount: number;
  dateRange: {
    current: { from: string; to: string };
    previous: { from: string; to: string };
    days: number;
  };
  kpi: {
    views: ViewsKpi;
    watchTimeHours: WatchTimeKpi;
    subscribersGained: SubscribersKpi;
    engagementRate: DeltaMetric;
    revenue: RevenueKpi;
  };
  viewsByPlatformDaily: ViewsByPlatformDaily;
  platformBreakdown: PlatformBreakdownItem[];
  // V1 topPosts removed
};
