// KPI calculator — apps/api version.
// Pure logic + data queries. Mirror apps/web/src/lib/kpi/calculator.ts nhưng dùng
// PrismaService (không extension-wrapped). Cross-tenant OK vì cron loop tenants.
import { Injectable, Logger } from '@nestjs/common';
import {
  endOfMonth,
  endOfQuarter,
  endOfYear,
  isAfter,
  startOfDay,
} from 'date-fns';
import type { KPI, KPIStatus, PeriodType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export type KpiActuals = {
  followers: number | null;
  followersGain: number;
  views: number;
  watchTime: number;
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
  averagePercent: number | null;
  newStatus: KPIStatus;
};

@Injectable()
export class KpiCalculatorService {
  private readonly logger = new Logger(KpiCalculatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  derivePeriodEnd(periodType: PeriodType, periodStart: Date): Date {
    switch (periodType) {
      case 'MONTHLY':
        return endOfMonth(periodStart);
      case 'QUARTERLY':
        return endOfQuarter(periodStart);
      case 'YEARLY':
        return endOfYear(periodStart);
    }
  }

  async computeChannelActuals(
    channelId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<KpiActuals> {
    const where = {
      channelId,
      date: { gte: startOfDay(periodStart), lte: periodEnd },
    };

    const [agg, latestRecord] = await Promise.all([
      this.prisma.analytics.aggregate({
        where,
        _sum: { views: true, watchTimeHours: true, subscriberDelta: true },
        _avg: { engagementRate: true },
      }),
      this.prisma.analytics.findFirst({
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

  async computeEmployeeActuals(
    employeeId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<KpiActuals> {
    const channels = await this.prisma.channel.findMany({
      where: {
        deletedAt: null,
        ownerships: { some: { employeeId } },
      },
      select: { id: true },
    });

    const channelIds = channels.map((c) => c.id);
    if (channelIds.length === 0) {
      return { followers: null, followersGain: 0, views: 0, watchTime: 0, engagement: 0 };
    }

    const where = {
      channelId: { in: channelIds },
      date: { gte: startOfDay(periodStart), lte: periodEnd },
    };

    const [agg, latestPerChannel] = await Promise.all([
      this.prisma.analytics.aggregate({
        where,
        _sum: { views: true, watchTimeHours: true, subscriberDelta: true },
        _avg: { engagementRate: true },
      }),
      this.prisma.$queryRaw<Array<{ subscribers: number }>>`
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

  computeAchievement(
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

    const newStatus = this.deriveStatus(
      averagePercent,
      kpi.periodStart,
      kpi.periodEnd,
      now,
    );

    return { averagePercent, perTargetPercent, newStatus };
  }

  deriveStatus(
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
      return periodEnded ? 'MISSED' : 'IN_PROGRESS';
    }

    if (achievementPercent >= 120) return 'EXCEEDED';
    if (achievementPercent >= 100) return 'ACHIEVED';
    return periodEnded ? 'MISSED' : 'IN_PROGRESS';
  }

  async recalculateAchievement(
    kpiId: string,
    now: Date = new Date(),
  ): Promise<AchievementResult> {
    const kpi = await this.prisma.kPI.findUnique({ where: { id: kpiId } });
    if (!kpi) throw new Error(`KPI ${kpiId} không tồn tại`);

    let actuals: KpiActuals;
    if (kpi.scope === 'PER_CHANNEL') {
      if (!kpi.channelId) {
        throw new Error(`KPI ${kpiId} scope=PER_CHANNEL nhưng channelId null`);
      }
      actuals = await this.computeChannelActuals(
        kpi.channelId,
        kpi.periodStart,
        kpi.periodEnd,
      );
    } else {
      actuals = await this.computeEmployeeActuals(
        kpi.employeeId,
        kpi.periodStart,
        kpi.periodEnd,
      );
    }

    const { averagePercent, perTargetPercent, newStatus } = this.computeAchievement(
      kpi,
      actuals,
      now,
    );

    await this.prisma.kPI.update({
      where: { id: kpiId },
      data: {
        achievementPercent: averagePercent,
        status: newStatus,
      },
    });

    return { actuals, perTargetPercent, averagePercent, newStatus };
  }
}
