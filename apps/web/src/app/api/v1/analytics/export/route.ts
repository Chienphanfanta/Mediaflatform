// GET /api/v1/analytics/export?channelIds=c1&channelIds=c2&from=&to=&format=csv|json
// CSV download hoặc JSON response. Yêu cầu MANAGER trở lên (meetsRole).
// LƯU Ý: Response cho CSV KHÔNG dùng ok() wrapper — phải trả raw text kèm
// Content-Disposition để browser trigger download.
import { endOfDay, startOfDay } from 'date-fns';
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { meetsRole } from '@/lib/rbac';
import { exportQuerySchema } from '@/lib/schemas/analytics';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => csvEscape(r[h])).join(','));
  return [headers.join(','), ...body].join('\n') + '\n';
}

export const GET = withAuth(
  async ({ req, user }) => {
    if (!meetsRole(user, 'MANAGER')) {
      return fail('FORBIDDEN', 'Export chỉ dành cho Manager trở lên', { status: 403 });
    }

    const url = new URL(req.url);
    const rawChannelIds = url.searchParams.getAll('channelIds');
    const parsed = exportQuerySchema.safeParse({
      channelIds: rawChannelIds.length > 0 ? rawChannelIds : undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      preset: url.searchParams.get('preset') ?? undefined,
      format: url.searchParams.get('format') ?? undefined,
    });
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Query không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { channelIds, format } = parsed.data;

    // Derive from/to: explicit > preset > default 30d
    let { from, to } = parsed.data;
    if (!from || !to) {
      const days =
        parsed.data.preset === '7d' ? 7 : parsed.data.preset === '90d' ? 90 : 30;
      to = to ?? new Date();
      from = from ?? new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    }

    // Lookup channels accessible to user — nếu channelIds rỗng, return all
    const userGroupIds = user.groups.map((g) => g.id);
    const baseWhere = user.isSuperAdmin
      ? { deletedAt: null }
      : {
          deletedAt: null,
          groups: { some: { groupId: { in: userGroupIds } } },
        };
    const accessibleChannels = await prisma.channel.findMany({
      where: channelIds && channelIds.length > 0
        ? { ...baseWhere, id: { in: channelIds } }
        : baseWhere,
      select: { id: true, name: true, platform: true },
    });

    // Verify denied channels nếu user explicit truyền channelIds
    if (channelIds && accessibleChannels.length !== channelIds.length) {
      const accessibleIds = new Set(accessibleChannels.map((c) => c.id));
      const denied = channelIds.filter((id) => !accessibleIds.has(id));
      return fail('FORBIDDEN', 'Không có quyền với một số kênh', {
        status: 403,
        details: { denied },
      });
    }

    if (accessibleChannels.length === 0) {
      return fail('NO_CHANNELS', 'Không có kênh nào để export', { status: 404 });
    }
    const effectiveChannelIds = accessibleChannels.map((c) => c.id);

    const channelById = new Map(accessibleChannels.map((c) => [c.id, c]));

    const rows = await prisma.analytics.findMany({
      where: {
        channelId: { in: effectiveChannelIds },
        date: { gte: startOfDay(from), lte: endOfDay(to) },
      },
      orderBy: [{ channelId: 'asc' }, { date: 'asc' }],
      select: {
        channelId: true,
        platform: true,
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

    const flat = rows.map((r) => {
      const c = channelById.get(r.channelId);
      return {
        channelId: r.channelId,
        channelName: c?.name ?? '',
        platform: r.platform,
        date: isoDate(r.date),
        views: r.views,
        watchTimeHours: r.watchTimeHours,
        subscribers: r.subscribers,
        subscriberDelta: r.subscriberDelta,
        revenue: r.revenue,
        engagementRate: r.engagementRate,
        impressions: r.impressions,
        clicks: r.clicks,
      };
    });

    if (format === 'json') {
      return ok({
        channelCount: accessibleChannels.length,
        rowCount: flat.length,
        from: isoDate(from),
        to: isoDate(to),
        rows: flat,
      });
    }

    // CSV — trả raw text với download headers
    const filename = `analytics-${isoDate(from)}_to_${isoDate(to)}.csv`;
    // BOM giúp Excel mở file UTF-8 đúng tiếng Việt
    const csv = '﻿' + toCsv(flat);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);
