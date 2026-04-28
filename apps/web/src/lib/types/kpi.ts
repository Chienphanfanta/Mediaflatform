// Types cho KPI client — match shape API /api/v1/kpi/*.
import type {
  KPIScope,
  KPIStatus,
  PeriodType,
  Platform,
} from '@prisma/client';

export type KpiBrief = {
  id: string;
  tenantId: string;
  scope: KPIScope;
  channelId: string | null;
  employeeId: string;
  periodType: PeriodType;
  periodStart: string; // ISO date
  periodEnd: string;
  targetFollowers: number | null;
  targetFollowersGain: number | null;
  targetViews: number | null;
  targetWatchTime: number | null;
  targetEngagement: number | null;
  achievementPercent: number | null;
  status: KPIStatus;
  notes: string | null;
  assignedById: string;
  assignedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type KpiWithRelations = KpiBrief & {
  channel: { id: string; name: string; platform: Platform } | null;
  employee: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  };
  assignedBy: { id: string; name: string };
};

export type KpiPerTargetPercent = {
  followers: number | null;
  followersGain: number | null;
  views: number | null;
  watchTime: number | null;
  engagement: number | null;
};

export type KpiActuals = {
  followers: number | null;
  followersGain: number;
  views: number;
  watchTime: number;
  engagement: number;
};

export type KpiRecalcResult = {
  kpiId: string;
  actuals: KpiActuals;
  perTargetPercent: KpiPerTargetPercent;
  averagePercent: number | null;
  status: KPIStatus;
};

export type KpiSummaryEmployee = {
  employee: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  };
  activeOn: string;
  totals: {
    totalKpis: number;
    byStatus: Record<string, number>;
    avgAchievement: number | null;
  };
  kpis: KpiWithRelations[];
};

export type KpiSummaryChannel = {
  channel: {
    id: string;
    name: string;
    platform: Platform;
    status: string;
  };
  activeOn: string;
  totals: {
    totalKpis: number;
    byStatus: Record<string, number>;
    avgAchievement: number | null;
  };
  kpis: KpiWithRelations[];
};

export type KpiListResponse = {
  items: KpiWithRelations[];
  total: number;
};

export type KpiListFilters = {
  employeeId?: string;
  channelId?: string;
  scope?: KPIScope;
  periodType?: PeriodType;
  status?: KPIStatus;
  /** YYYY-MM-DD — KPIs có period chứa date này */
  activeOn?: string;
};

export type CreateKpiPayload = {
  scope: KPIScope;
  channelId?: string;
  employeeId: string;
  periodType: PeriodType;
  /** ISO date string */
  periodStart: string;
  notes?: string | null;
  targetFollowers?: number | null;
  targetFollowersGain?: number | null;
  targetViews?: number | null;
  targetWatchTime?: number | null;
  targetEngagement?: number | null;
};

export type UpdateKpiPayload = {
  notes?: string | null;
  targetFollowers?: number | null;
  targetFollowersGain?: number | null;
  targetViews?: number | null;
  targetWatchTime?: number | null;
  targetEngagement?: number | null;
};

export type BulkAssignKpiPayload = {
  employeeIds: string[];
  scope: KPIScope;
  channelId?: string;
  periodType: PeriodType;
  periodStart: string;
  notes?: string | null;
  targetFollowers?: number | null;
  targetFollowersGain?: number | null;
  targetViews?: number | null;
  targetWatchTime?: number | null;
  targetEngagement?: number | null;
};
