// Types cho Report Generator. V2: chỉ giữ CHANNEL + HR (no posts/tasks).
// Sprint 6 thêm KPI_ACHIEVEMENT, CHANNEL_GROWTH, DEPARTMENT_SUMMARY report types.
import type { Platform } from '@prisma/client';

export type ReportType = 'CHANNEL' | 'HR';
export type ReportFormat = 'PDF' | 'CSV' | 'JSON';
export type ReportPeriod = '7d' | '30d' | '90d' | 'custom';

export type ReportInput = {
  type: ReportType;
  period: ReportPeriod;
  from?: string; // ISO khi period=custom
  to?: string;
  channelIds?: string[];
  groupId?: string;
  format: ReportFormat;
};

export type PeriodMeta = {
  from: string; // YYYY-MM-DD
  to: string;
  days: number;
  label: string;
};

// ───── Channel report (V2 stripped: bỏ postCount, topPosts) ─────
export type ChannelReportRow = {
  id: string;
  name: string;
  platform: Platform;
  status: string;
  views: number;
  watchTimeHours: number;
  subscribersGained: number;
  revenue: number;
  avgEngagement: number;
  viewsDeltaPct: number | null;
};

export type ChannelReportData = {
  type: 'CHANNEL';
  generatedAt: string;
  period: PeriodMeta;
  scope: { groupId: string | null; channelIds: string[] | null };
  totals: {
    channels: number;
    views: number;
    watchTimeHours: number;
    subscribersGained: number;
    revenue: number;
  };
  channels: ChannelReportRow[];
};

// ───── HR report (V2 stripped: bỏ task + post fields) ─────
export type HRReportRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  groups: string[];
};

export type HRReportData = {
  type: 'HR';
  generatedAt: string;
  period: PeriodMeta;
  scope: { groupId: string | null };
  totals: {
    members: number;
  };
  members: HRReportRow[];
};

export type ReportData = ChannelReportData | HRReportData;

// History entry trong localStorage
export type ReportHistoryEntry = {
  id: string;
  type: ReportType;
  period: ReportPeriod;
  format: ReportFormat;
  generatedAt: string;
  scopeLabel: string;
};
