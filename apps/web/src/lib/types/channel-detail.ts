// Types cho /api/v1/analytics/channels/:id/detail
// V2: bỏ ChannelPosts (Post entity không còn).
import type { ChannelStatus, Platform } from '@prisma/client';

export type ChannelInfo = {
  id: string;
  name: string;
  platform: Platform;
  status: ChannelStatus;
  monetizationEnabled: boolean;
  subscriberCount: number | null;
  metadata: Record<string, unknown> | null;
};

export type Milestone = {
  date: string;
  value: number;
  label: string;
};

export type OverviewData = {
  labels: string[];
  views: number[];
  watchTimeHours: number[];
  subscribers: number[];
  subscriberDelta: number[];
  revenue: number[];
  milestones: Milestone[];
};

export type ViolationItem = {
  id: string;
  message: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

export type MonetizationStatus =
  | 'APPROVED'
  | 'UNDER_REVIEW'
  | 'NOT_MONETIZED'
  | 'DEMONETIZED';

export type MonetizationData = {
  status: MonetizationStatus;
  watchTimeYearlyHours: number;
  watchTimeThreshold: 4000;
  watchTimeProgressPct: number;
  subscribersCount: number;
  subscribersThreshold: 1000;
  subscribersProgressPct: number;
  violations: ViolationItem[];
  monthlyRevenue: { labels: string[]; data: number[] };
};

export type ComparisonData = {
  period: '7d' | '30d' | '90d';
  days: number;
  current: PeriodAgg;
  previous: PeriodAgg;
  score: {
    total: number;
    breakdown: { growth: number; engagement: number; consistency: number };
    max: { growth: 40; engagement: 30; consistency: 30 };
  };
};

export type PeriodAgg = {
  from: string;
  to: string;
  totalViews: number;
  totalSubscribers: number;
  totalRevenue: number;
  avgEngagement: number;
  daily: number[];
};

export type ChannelDetailResponse = {
  channel: ChannelInfo;
  period: '7d' | '30d' | '90d';
  overview: OverviewData;
  monetization: MonetizationData | null; // null khi platform != YOUTUBE
  comparison: ComparisonData;
};

// V1 Posts list types removed — Post entity no longer exists.
