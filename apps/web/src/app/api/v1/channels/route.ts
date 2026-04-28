// GET /api/v1/channels — list channels trong scope.
//   ?stats=1     → kèm monthStats (views, watchTime, subs/eng tháng này) + metadata
//   ?category=X  → filter theo category
//   ?status=X    → filter theo status
//   ?platform=X  → filter theo platform
// POST /api/v1/channels — tạo channel mới + (optional) gán PRIMARY owner.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';
import { createChannelSchema } from '@/lib/schemas/channels';

export const GET = withAuth(
  async ({ req, user }) => {
    const url = new URL(req.url);
    const includeStats = url.searchParams.get('stats') === '1';
    const category = url.searchParams.get('category');
    const status = url.searchParams.get('status');
    const platform = url.searchParams.get('platform');

    const groupIds = user.groups.map((g) => g.id);
    const where: Prisma.ChannelWhereInput = user.isSuperAdmin
      ? { deletedAt: null }
      : { deletedAt: null, groups: { some: { groupId: { in: groupIds } } } };

    if (category) where.category = category;
    if (status && ['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(status)) {
      where.status = status as Prisma.ChannelWhereInput['status'];
    }
    if (
      platform &&
      ['YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'X', 'TELEGRAM', 'WHATSAPP'].includes(platform)
    ) {
      where.platform = platform as Prisma.ChannelWhereInput['platform'];
    }

    const rows = await prisma.channel.findMany({
      where,
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        platform: true,
        status: true,
        accountId: true,
        externalUrl: true,
        description: true,
        category: true,
        tokenExpiresAt: true,
        lastSyncedAt: true,
        lastSyncError: true,
        ...(includeStats && { metadata: true, updatedAt: true }),
        groups: { select: { groupId: true, group: { select: { name: true } } } },
        ownerships: {
          select: {
            role: true,
            employee: { select: { id: true, name: true, email: true, avatar: true } },
          },
          orderBy: { role: 'asc' }, // PRIMARY first
        },
      },
    });

    if (!includeStats) {
      return ok(
        rows.map((c) => ({
          id: c.id,
          name: c.name,
          platform: c.platform,
          status: c.status,
          accountId: c.accountId,
          externalUrl: c.externalUrl,
          description: c.description,
          category: c.category,
          lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
          lastSyncError: c.lastSyncError,
          groupIds: c.groups.map((g) => g.groupId),
          ownerships: c.ownerships.map((o) => ({
            role: o.role,
            employeeId: o.employee.id,
            name: o.employee.name,
            email: o.employee.email,
            avatar: o.employee.avatar,
          })),
        })),
      );
    }

    // Aggregate monthly stats
    const channelIds = rows.map((c) => c.id);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const today = new Date();

    const analyticsAgg =
      channelIds.length === 0
        ? []
        : await prisma.analytics.groupBy({
            by: ['channelId'],
            where: {
              channelId: { in: channelIds },
              date: { gte: monthStart, lte: today },
            },
            _sum: { views: true, watchTimeHours: true, subscriberDelta: true },
            _avg: { engagementRate: true },
          });

    const aggMap = new Map(
      (analyticsAgg as Array<Record<string, any>>).map((a) => [a.channelId, a]),
    );

    return ok(
      rows.map((c) => {
        const meta = (c.metadata as Record<string, unknown> | null) ?? null;
        const agg = aggMap.get(c.id);
        return {
          id: c.id,
          name: c.name,
          platform: c.platform,
          status: c.status,
          accountId: c.accountId,
          externalUrl: c.externalUrl,
          description: c.description,
          category: c.category,
          tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
          lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
          lastSyncError: c.lastSyncError,
          groupIds: c.groups.map((g) => g.groupId),
          groupNames: c.groups.map((g) => g.group.name),
          metadata: meta,
          thumbnailUrl:
            (meta?.thumbnailUrl as string | undefined) ??
            (meta?.profileImageUrl as string | undefined) ??
            (meta?.profilePictureUrl as string | undefined) ??
            null,
          subscriberCount:
            (meta?.subscriberCount as number | undefined) ??
            (meta?.followersCount as number | undefined) ??
            (meta?.fanCount as number | undefined) ??
            (meta?.memberCount as number | undefined) ??
            null,
          ownerships: c.ownerships.map((o) => ({
            role: o.role,
            employeeId: o.employee.id,
            name: o.employee.name,
            email: o.employee.email,
            avatar: o.employee.avatar,
          })),
          monthStats: {
            views: Number(agg?._sum?.views ?? 0),
            watchTimeHours:
              Math.round(Number(agg?._sum?.watchTimeHours ?? 0) * 10) / 10,
            subscriberDelta: Number(agg?._sum?.subscriberDelta ?? 0),
            engagementRate:
              Math.round(Number(agg?._avg?.engagementRate ?? 0) * 100) / 100,
          },
        };
      }),
    );
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);

export const POST = withAuth(
  async ({ req, user }) => {
    const body = await req.json().catch(() => null);
    const parsed = createChannelSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }

    const groupIds = parsed.data.groupIds ?? [];

    // Permission: cần CREATE quyền trên ít nhất 1 group được gán (hoặc SuperAdmin).
    const canCreate =
      user.isSuperAdmin ||
      groupIds.some(
        (gid) =>
          hasPermission(user, 'channel', 'CREATE', { groupId: gid }) ||
          hasPermission(user, 'channel', 'FULL', { groupId: gid }),
      );
    if (!canCreate) {
      return fail('FORBIDDEN', 'Không có quyền tạo kênh trong groups này', {
        status: 403,
      });
    }

    if (!user.isSuperAdmin) {
      const userGroupIds = new Set(user.groups.map((g) => g.id));
      const outOfScope = groupIds.filter((gid) => !userGroupIds.has(gid));
      if (outOfScope.length > 0) {
        return fail('FORBIDDEN_GROUP', 'Group nằm ngoài scope của bạn', {
          status: 403,
          details: { outOfScope },
        });
      }
    }

    // Idempotent: trùng (platform, accountId) → 409
    const existing = await prisma.channel.findFirst({
      where: { platform: parsed.data.platform, accountId: parsed.data.accountId },
      select: { id: true, deletedAt: true },
    });
    if (existing) {
      return fail(
        'CHANNEL_EXISTS',
        existing.deletedAt
          ? 'Kênh đã tồn tại nhưng đã bị xoá — restore thay vì tạo mới'
          : 'Kênh với accountId này đã tồn tại',
        { status: 409, details: { channelId: existing.id } },
      );
    }

    const created = await prisma.channel.create({
      data: {
        tenantId: user.tenantId,
        name: parsed.data.name,
        platform: parsed.data.platform,
        accountId: parsed.data.accountId,
        externalUrl: parsed.data.externalUrl ?? null,
        description: parsed.data.description ?? null,
        category: parsed.data.category ?? null,
        status: 'ACTIVE',
        groups:
          groupIds.length > 0
            ? { create: groupIds.map((gid) => ({ groupId: gid })) }
            : undefined,
        ownerships: parsed.data.primaryOwnerId
          ? {
              create: {
                employeeId: parsed.data.primaryOwnerId,
                role: 'PRIMARY',
                assignedById: user.id,
              },
            }
          : undefined,
      },
      select: {
        id: true,
        name: true,
        platform: true,
        status: true,
        accountId: true,
        category: true,
      },
    });

    return ok(created, { status: 201 });
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
