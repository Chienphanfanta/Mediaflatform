// GET /api/v1/dashboard/overview
// V2 stripped: bỏ posts/tasks/topPosts/scheduledToday/tasksDue (Post + Task entity không còn).
// Scope: SuperAdmin thấy tất cả channel; user thường chỉ thấy channel thuộc group của mình.

import { Platform, ChannelStatus, Prisma } from '@prisma/client';
import { startOfDay, subDays } from 'date-fns';

import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { ok } from '@/lib/api-response';
import type {
  DashboardOverview,
  ViewsByDay,
  ChannelHealthItem,
} from '@/lib/types/dashboard';

const VIEW_PLATFORMS: Array<keyof Omit<ViewsByDay, 'date'>> = [
  'YOUTUBE',
  'FACEBOOK',
  'INSTAGRAM',
  'TELEGRAM',
  'WHATSAPP',
];

function healthFromStatus(s: ChannelStatus): ChannelHealthItem['health'] {
  switch (s) {
    case 'ACTIVE':
      return 'green';
    case 'TOKEN_EXPIRED':
    case 'SUSPENDED':
      return 'yellow';
    case 'DISCONNECTED':
    case 'ERROR':
    default:
      return 'red';
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

function emptyDay(date: string): ViewsByDay {
  return {
    date,
    YOUTUBE: 0,
    FACEBOOK: 0,
    INSTAGRAM: 0,
    TELEGRAM: 0,
    WHATSAPP: 0,
  };
}

export const GET = withAuth(
  async ({ user }) => {
    const now = new Date();
    const today = startOfDay(now);
    const yesterday = subDays(today, 1);
    const sevenDaysAgo = subDays(today, 6);

    const groupIds = user.groups.map((g) => g.id);
    const channelWhere: Prisma.ChannelWhereInput = user.isSuperAdmin
      ? { deletedAt: null }
      : {
          deletedAt: null,
          groups: { some: { groupId: { in: groupIds } } },
        };

    const channels = await prisma.channel.findMany({
      where: channelWhere,
      select: { id: true, name: true, platform: true, status: true },
    });
    const channelIds = channels.map((c) => c.id);

    if (channelIds.length === 0) {
      const emptyDays: ViewsByDay[] = [];
      for (let i = 6; i >= 0; i--) {
        emptyDays.push(emptyDay(isoDate(subDays(today, i))));
      }
      const empty: DashboardOverview = {
        metrics: {
          viewsToday: { value: 0, deltaPct: null, vsValue: 0 },
          watchTimeHoursToday: { value: 0, deltaPct: null, vsValue: 0 },
        },
        viewsByDay: emptyDays,
        channels: [],
      };
      return ok(empty);
    }

    const [analyticsToday, analyticsYesterday, analyticsRange] = await Promise.all([
      prisma.analytics.findMany({
        where: { channelId: { in: channelIds }, date: today },
        select: { channelId: true, views: true, watchTimeHours: true },
      }),
      prisma.analytics.findMany({
        where: { channelId: { in: channelIds }, date: yesterday },
        select: { views: true, watchTimeHours: true },
      }),
      prisma.analytics.findMany({
        where: {
          channelId: { in: channelIds },
          date: { gte: sevenDaysAgo, lte: today },
        },
        select: { date: true, platform: true, views: true },
      }),
    ]);

    const sumToday = analyticsToday.reduce(
      (a, b) => ({
        views: a.views + b.views,
        wt: a.wt + b.watchTimeHours,
      }),
      { views: 0, wt: 0 },
    );
    const sumYesterday = analyticsYesterday.reduce(
      (a, b) => ({
        views: a.views + b.views,
        wt: a.wt + b.watchTimeHours,
      }),
      { views: 0, wt: 0 },
    );

    // Build ViewsByDay: fill đủ 7 ngày
    const daysMap = new Map<string, ViewsByDay>();
    for (let i = 6; i >= 0; i--) {
      const key = isoDate(subDays(today, i));
      daysMap.set(key, emptyDay(key));
    }
    for (const row of analyticsRange) {
      const key = isoDate(row.date);
      const entry = daysMap.get(key);
      if (!entry) continue;
      const p = row.platform as Platform;
      if ((VIEW_PLATFORMS as Platform[]).includes(p)) {
        // safe — narrowed to ViewsByDay platform keys
        (entry as Record<string, number | string>)[p] =
          ((entry as Record<string, number | string>)[p] as number) + row.views;
      }
    }
    const viewsByDay = Array.from(daysMap.values());

    const todayViewsByChannel = new Map(
      analyticsToday.map((a) => [a.channelId, a.views]),
    );
    const channelsOut: ChannelHealthItem[] = channels.map((c) => ({
      id: c.id,
      name: c.name,
      platform: c.platform,
      status: c.status,
      viewsToday: todayViewsByChannel.get(c.id) ?? 0,
      health: healthFromStatus(c.status),
    }));

    const body: DashboardOverview = {
      metrics: {
        viewsToday: {
          value: sumToday.views,
          deltaPct: deltaPct(sumToday.views, sumYesterday.views),
          vsValue: sumYesterday.views,
        },
        watchTimeHoursToday: {
          value: Math.round(sumToday.wt * 10) / 10,
          deltaPct: deltaPct(sumToday.wt, sumYesterday.wt),
          vsValue: Math.round(sumYesterday.wt * 10) / 10,
        },
      },
      viewsByDay,
      channels: channelsOut,
    };

    return ok(body);
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
