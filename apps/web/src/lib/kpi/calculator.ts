// KPI calculator — derives periodEnd, computes actuals from Analytics,
// updates achievementPercent + status.
//
// Achievement formula: AVERAGE of (actual_i / target_i × 100) across targets that
// were SET. Targets không set thì skip. Tất cả targets là "higher is better".
//
// Status logic:
//   now < periodStart  → NOT_STARTED
//   now > periodEnd:
//     achievement ≥ 120 → EXCEEDED
//     achievement ≥ 100 → ACHIEVED
//     else              → MISSED
//   trong period:
//     achievement ≥ 120 → EXCEEDED
//     achievement ≥ 100 → ACHIEVED
//     else              → IN_PROGRESS
//
// Multi-target mapping:
//   targetFollowers      → followers ở cuối period (subscribers latest record)
//   targetFollowersGain  → SUM(subscriberDelta) trong period
//   targetViews          → SUM(views) trong period
//   targetWatchTime      → SUM(watchTimeHours) trong period
//   targetEngagement     → AVG(engagementRate) trong period
import {
  endOfMonth,
  endOfQuarter,
  endOfYear,
  isAfter,
  startOfDay,
} from 'date-fns';
import type { KPI, KPIStatus, PeriodType } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export type KpiActuals = {
  /** Subscribers ở record mới nhất trong period (null nếu không có data) */
  followers: number | null;
  /** SUM(subscriberDelta) trong period */
  followersGain: number;
  /** SUM(views) trong period */
  views: number;
  /** SUM(watchTimeHours) trong period */
  watchTime: number;
  /** AVG(engagementRate) trong period */
  engagement: number;
};

export type PerTargetPercent = {
  followers: number | null;
  followersGain: number | null;
  views: number | null;
  watchTime: number | null;
  engagement: number | null;
};

export type AchievementResult = {
  actuals: KpiActuals;
  perTargetPercent: PerTargetPercent;
  /** Average của các target có set; null nếu không target nào set */
  averagePercent: number | null;
  newStatus: KPIStatus;
};

const ZERO_ACTUALS: KpiActuals = {
  followers: null,
  followersGain: 0,
  views: 0,
  watchTime: 0,
  engagement: 0,
};

// ────────── Date utilities ──────────

/**
 * Compute periodEnd từ periodType + periodStart.
 * MONTHLY: end of month, QUARTERLY: end of quarter, YEARLY: end of year.
 */
export function derivePeriodEnd(
  periodType: PeriodType,
  periodStart: Date,
): Date {
  switch (periodType) {
    case 'MONTHLY':
      return endOfMonth(periodStart);
    case 'QUARTERLY':
      return endOfQuarter(periodStart);
    case 'YEARLY':
      return endOfYear(periodStart);
  }
}

// ────────── Actuals queries ──────────

/**
 * Aggregate Analytics của 1 channel trong period.
 * Trả null cho followers nếu period không có data.
 */
export async function computeChannelActuals(
  channelId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<KpiActuals> {
  const where = {
    channelId,
    date: { gte: startOfDay(periodStart), lte: periodEnd },
  };

  const [agg, latestRecord] = await Promise.all([
    prisma.analytics.aggregate({
      where,
      _sum: { views: true, watchTimeHours: true, subscriberDelta: true },
      _avg: { engagementRate: true },
    }),
    prisma.analytics.findFirst({
      where,
      orderBy: { date: 'desc' },
      select: { subscribers: true },
    }),
  ]);

  return {
    followers: latestRecord?.subscribers ?? null,
    followersGain: agg._sum.subscriberDelta ?? 0,
    views: agg._sum.views ?? 0,
    watchTime: agg._sum.watchTimeHours ?? 0,
    engagement: Math.round((agg._avg.engagementRate ?? 0) * 100) / 100,
  };
}

/**
 * Aggregate Analytics của tất cả channels mà employee là owner (PRIMARY hoặc
 * SECONDARY) trong period. Channels là tenant-scoped qua Prisma extension —
 * chỉ thấy channels của tenant employee thuộc về.
 */
export async function computeEmployeeActuals(
  employeeId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<KpiActuals> {
  const channels = await prisma.channel.findMany({
    where: {
      deletedAt: null,
      ownerships: { some: { employeeId } },
    },
    select: { id: true },
  });

  const channelIds = channels.map((c) => c.id);
  if (channelIds.length === 0) return { ...ZERO_ACTUALS };

  const where = {
    channelId: { in: channelIds },
    date: { gte: startOfDay(periodStart), lte: periodEnd },
  };

  const [agg, latestPerChannel] = await Promise.all([
    prisma.analytics.aggregate({
      where,
      _sum: { views: true, watchTimeHours: true, subscriberDelta: true },
      _avg: { engagementRate: true },
    }),
    // Followers cho PER_EMPLOYEE = SUM(subscribers latest per channel)
    prisma.$queryRaw<Array<{ subscribers: number }>>`
      SELECT DISTINCT ON ("channelId") "subscribers"
      FROM "Analytics"
      WHERE "channelId" = ANY(${channelIds}::text[])
        AND "date" <= ${periodEnd}::date
      ORDER BY "channelId", "date" DESC
    `,
  ]);

  const followers = latestPerChannel.length
    ? latestPerChannel.reduce((s, r) => s + Number(r.subscribers), 0)
    : null;

  return {
    followers,
    followersGain: agg._sum.subscriberDelta ?? 0,
    views: agg._sum.views ?? 0,
    watchTime: agg._sum.watchTimeHours ?? 0,
    engagement: Math.round((agg._avg.engagementRate ?? 0) * 100) / 100,
  };
}

// ────────── Achievement computation ──────────

/**
 * Tính achievement % per-target + average + status từ actuals + targets + dates.
 */
export function computeAchievement(
  kpi: Pick<
    KPI,
    | 'periodStart'
    | 'periodEnd'
    | 'targetFollowers'
    | 'targetFollowersGain'
    | 'targetViews'
    | 'targetWatchTime'
    | 'targetEngagement'
  >,
  actuals: KpiActuals,
  now: Date = new Date(),
): { averagePercent: number | null; perTargetPercent: PerTargetPercent; newStatus: KPIStatus } {
  const pct = (actual: number | null, target: number | null | undefined): number | null => {
    if (target == null || target === 0) return null;
    if (actual == null) return 0;
    return Math.round((actual / target) * 10000) / 100;
  };

  const perTargetPercent: PerTargetPercent = {
    followers: pct(actuals.followers, kpi.targetFollowers),
    followersGain: pct(actuals.followersGain, kpi.targetFollowersGain),
    views: pct(actuals.views, kpi.targetViews),
    watchTime: pct(actuals.watchTime, kpi.targetWatchTime),
    engagement: pct(actuals.engagement, kpi.targetEngagement),
  };

  const setPercents = Object.values(perTargetPercent).filter(
    (v): v is number => v !== null,
  );

  const averagePercent =
    setPercents.length > 0
      ? Math.round(
          (setPercents.reduce((s, v) => s + v, 0) / setPercents.length) * 100,
        ) / 100
      : null;

  const newStatus = deriveStatus(
    averagePercent,
    kpi.periodStart,
    kpi.periodEnd,
    now,
  );

  return { averagePercent, perTargetPercent, newStatus };
}

/**
 * Derive status từ achievementPercent + period dates + now.
 */
export function deriveStatus(
  achievementPercent: number | null,
  periodStart: Date,
  periodEnd: Date,
  now: Date = new Date(),
): KPIStatus {
  const periodEndDay = new Date(periodEnd);
  periodEndDay.setUTCHours(23, 59, 59, 999);

  if (now < periodStart) return 'NOT_STARTED';

  const periodEnded = isAfter(now, periodEndDay);

  if (achievementPercent === null) {
    // Không target nào set → trạng thái dựa thuần vào dates
    return periodEnded ? 'MISSED' : 'IN_PROGRESS';
  }

  if (achievementPercent >= 120) return 'EXCEEDED';
  if (achievementPercent >= 100) return 'ACHIEVED';
  return periodEnded ? 'MISSED' : 'IN_PROGRESS';
}

// ────────── Main entry ──────────

/**
 * Recalculate achievement cho 1 KPI: load, compute actuals, persist update.
 * Returns full result để caller có thể inspect breakdown.
 *
 * Throws nếu KPI không tồn tại (404) hoặc PER_CHANNEL không có channelId (data error).
 */
export async function recalculateAchievement(
  kpiId: string,
  now: Date = new Date(),
): Promise<AchievementResult> {
  const kpi = await prisma.kPI.findUnique({ where: { id: kpiId } });
  if (!kpi) throw new Error(`KPI ${kpiId} không tồn tại`);

  let actuals: KpiActuals;
  if (kpi.scope === 'PER_CHANNEL') {
    if (!kpi.channelId) {
      throw new Error(`KPI ${kpiId} scope=PER_CHANNEL nhưng channelId null`);
    }
    actuals = await computeChannelActuals(
      kpi.channelId,
      kpi.periodStart,
      kpi.periodEnd,
    );
  } else {
    actuals = await computeEmployeeActuals(
      kpi.employeeId,
      kpi.periodStart,
      kpi.periodEnd,
    );
  }

  const { averagePercent, perTargetPercent, newStatus } = computeAchievement(
    kpi,
    actuals,
    now,
  );

  await prisma.kPI.update({
    where: { id: kpiId },
    data: {
      achievementPercent: averagePercent,
      status: newStatus,
    },
  });

  return { actuals, perTargetPercent, averagePercent, newStatus };
}
