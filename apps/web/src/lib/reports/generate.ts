// Report data builders — V2 stripped: bỏ Post + Task references.
// V1 buildContentReport entirely removed (CONTENT type bỏ).
// V1 Channel: bỏ postCount + topPosts. V1 HR: bỏ task + post stats — chỉ name/email/role/groups.
// Sprint 6 sẽ thêm KPI_ACHIEVEMENT, CHANNEL_GROWTH, DEPARTMENT_SUMMARY report types.
import { Prisma, type Platform } from '@prisma/client';
import { format, startOfDay, subDays } from 'date-fns';

import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';
import type { GenerateReportInput } from '@/lib/schemas/reports';
import type {
  ChannelReportData,
  ChannelReportRow,
  HRReportData,
  HRReportRow,
  PeriodMeta,
  ReportData,
} from '@/lib/types/reports';

const PLATFORMS: Platform[] = [
  'YOUTUBE',
  'FACEBOOK',
  'INSTAGRAM',
  'X',
  'TELEGRAM',
  'WHATSAPP',
];

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
function isoDate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function buildPeriod(input: GenerateReportInput): PeriodMeta {
  if (input.period === 'custom' && input.from && input.to) {
    const days =
      Math.floor(
        (startOfDay(input.to).getTime() - startOfDay(input.from).getTime()) /
          86_400_000,
      ) + 1;
    return {
      from: isoDate(input.from),
      to: isoDate(input.to),
      days,
      label: `${isoDate(input.from)} → ${isoDate(input.to)}`,
    };
  }
  const days = input.period === '7d' ? 7 : input.period === '90d' ? 90 : 30;
  const to = new Date();
  const from = subDays(to, days - 1);
  return {
    from: isoDate(from),
    to: isoDate(to),
    days,
    label: `${days} ngày qua`,
  };
}

function periodToDates(period: PeriodMeta): { from: Date; to: Date } {
  return {
    from: new Date(period.from),
    to: new Date(period.to + 'T23:59:59.999Z'),
  };
}

async function getScopedChannelIds(
  user: SessionUser,
  groupId?: string,
  channelIds?: string[],
): Promise<{ ids: string[]; channels: Array<{ id: string; name: string; platform: Platform; status: string }> }> {
  const userGroupIds = user.groups.map((g) => g.id);
  const baseWhere: Prisma.ChannelWhereInput = {
    deletedAt: null,
    ...(channelIds && channelIds.length > 0 ? { id: { in: channelIds } } : {}),
  };

  if (!user.isSuperAdmin) {
    if (groupId && !userGroupIds.includes(groupId)) {
      throw new Error('FORBIDDEN_GROUP');
    }
    baseWhere.groups = {
      some: { groupId: { in: groupId ? [groupId] : userGroupIds } },
    };
  } else if (groupId) {
    baseWhere.groups = { some: { groupId } };
  }

  const channels = await prisma.channel.findMany({
    where: baseWhere,
    select: { id: true, name: true, platform: true, status: true },
  });

  if (channelIds && channelIds.length > channels.length) {
    throw new Error('CHANNEL_OUT_OF_SCOPE');
  }
  return { ids: channels.map((c) => c.id), channels };
}

// =================================================================
// CHANNEL report — V2 stripped (no postCount + topPosts)
// =================================================================
async function buildChannelReport(
  input: GenerateReportInput,
  user: SessionUser,
): Promise<ChannelReportData> {
  const period = buildPeriod(input);
  const { from, to } = periodToDates(period);
  const days = period.days;
  const prevTo = subDays(from, 1);
  const prevFrom = subDays(prevTo, days - 1);

  const { ids: channelIds, channels } = await getScopedChannelIds(
    user,
    input.groupId,
    input.channelIds,
  );

  if (channelIds.length === 0) {
    return {
      type: 'CHANNEL',
      generatedAt: new Date().toISOString(),
      period,
      scope: {
        groupId: input.groupId ?? null,
        channelIds: input.channelIds ?? null,
      },
      totals: {
        channels: 0,
        views: 0,
        watchTimeHours: 0,
        subscribersGained: 0,
        revenue: 0,
      },
      channels: [],
    };
  }

  const [curRows, prevRows] = await Promise.all([
    prisma.analytics.findMany({
      where: { channelId: { in: channelIds }, date: { gte: from, lte: to } },
      select: {
        channelId: true,
        views: true,
        watchTimeHours: true,
        subscriberDelta: true,
        revenue: true,
        engagementRate: true,
      },
    }),
    prisma.analytics.findMany({
      where: {
        channelId: { in: channelIds },
        date: { gte: prevFrom, lte: prevTo },
      },
      select: { channelId: true, views: true },
    }),
  ]);

  type Agg = {
    views: number;
    wt: number;
    subs: number;
    rev: number;
    engSum: number;
    engCount: number;
  };
  const curAgg = new Map<string, Agg>();
  for (const r of curRows) {
    const a = curAgg.get(r.channelId) ?? {
      views: 0,
      wt: 0,
      subs: 0,
      rev: 0,
      engSum: 0,
      engCount: 0,
    };
    a.views += r.views;
    a.wt += r.watchTimeHours;
    a.subs += r.subscriberDelta;
    a.rev += r.revenue;
    a.engSum += r.engagementRate;
    a.engCount += 1;
    curAgg.set(r.channelId, a);
  }
  const prevViewsMap = new Map<string, number>();
  for (const r of prevRows) {
    prevViewsMap.set(
      r.channelId,
      (prevViewsMap.get(r.channelId) ?? 0) + r.views,
    );
  }

  const rows: ChannelReportRow[] = channels.map((c) => {
    const a = curAgg.get(c.id) ?? {
      views: 0,
      wt: 0,
      subs: 0,
      rev: 0,
      engSum: 0,
      engCount: 0,
    };
    const prev = prevViewsMap.get(c.id) ?? 0;
    const deltaPct = prev > 0 ? r2(((a.views - prev) / prev) * 100) : null;
    return {
      id: c.id,
      name: c.name,
      platform: c.platform,
      status: c.status,
      views: a.views,
      watchTimeHours: r2(a.wt),
      subscribersGained: a.subs,
      revenue: r2(a.rev),
      avgEngagement: r2(a.engCount ? a.engSum / a.engCount : 0),
      viewsDeltaPct: deltaPct,
    };
  });

  rows.sort((a, b) => b.views - a.views);

  return {
    type: 'CHANNEL',
    generatedAt: new Date().toISOString(),
    period,
    scope: {
      groupId: input.groupId ?? null,
      channelIds: input.channelIds ?? null,
    },
    totals: {
      channels: rows.length,
      views: rows.reduce((s, r) => s + r.views, 0),
      watchTimeHours: r2(rows.reduce((s, r) => s + r.watchTimeHours, 0)),
      subscribersGained: rows.reduce((s, r) => s + r.subscribersGained, 0),
      revenue: r2(rows.reduce((s, r) => s + r.revenue, 0)),
    },
    channels: rows,
  };
}

// =================================================================
// HR report — V2 stripped (no task/post fields)
// =================================================================
async function buildHRReport(
  input: GenerateReportInput,
  user: SessionUser,
): Promise<HRReportData> {
  const period = buildPeriod(input);
  const userGroupIds = user.groups.map((g) => g.id);

  if (
    input.groupId &&
    !user.isSuperAdmin &&
    !userGroupIds.includes(input.groupId)
  ) {
    throw new Error('FORBIDDEN_GROUP');
  }

  const groupFilter: Prisma.GroupMemberWhereInput = input.groupId
    ? { groupId: input.groupId }
    : user.isSuperAdmin
      ? {}
      : { groupId: { in: userGroupIds } };

  const members = await prisma.user.findMany({
    where: {
      deletedAt: null,
      groupMembers: { some: groupFilter },
    },
    select: {
      id: true,
      name: true,
      email: true,
      groupMembers: {
        include: { group: { select: { name: true } } },
      },
    },
  });

  const ROLE_RANK: Record<string, number> = {
    ADMIN: 4,
    MANAGER: 3,
    STAFF: 2,
    VIEWER: 1,
  };

  const rows: HRReportRow[] = members.map((m) => {
    const roleObj = m.groupMembers.reduce<{ role: string; rank: number } | null>(
      (best, mb) => {
        const rank = ROLE_RANK[mb.role] ?? 0;
        return !best || rank > best.rank ? { role: mb.role, rank } : best;
      },
      null,
    );
    return {
      id: m.id,
      name: m.name,
      email: m.email,
      role: roleObj?.role ?? '—',
      groups: m.groupMembers.map((mb) => mb.group.name),
    };
  });

  return {
    type: 'HR',
    generatedAt: new Date().toISOString(),
    period,
    scope: { groupId: input.groupId ?? null },
    totals: { members: rows.length },
    members: rows,
  };
}

// =================================================================
// Dispatcher
// =================================================================
export async function generateReport(
  input: GenerateReportInput,
  user: SessionUser,
): Promise<ReportData> {
  switch (input.type) {
    case 'CHANNEL':
      return buildChannelReport(input, user);
    case 'HR':
      return buildHRReport(input, user);
    default: {
      const _exhaustive: never = input.type;
      void _exhaustive;
      throw new Error('UNKNOWN_REPORT_TYPE');
    }
  }
}

// Suppress unused — PLATFORMS có thể cần khi Phase 9 build CHANNEL_GROWTH report
void PLATFORMS;
