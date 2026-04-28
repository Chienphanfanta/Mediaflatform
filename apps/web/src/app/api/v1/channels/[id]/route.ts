// GET    /api/v1/channels/:id — chi tiết + ownerships + 7 ngày metrics gần nhất.
// PUT    /api/v1/channels/:id — update name/description/category/externalUrl/status.
// DELETE /api/v1/channels/:id — soft delete (set deletedAt + clear tokens).
//
// KHÔNG revoke token tại provider — đó là việc của /api/v1/platforms/:p/disconnect/:id.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, noContent, ok } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';
import { updateChannelSchema } from '@/lib/schemas/channels';

async function loadChannelWithScope(id: string) {
  return prisma.channel.findFirst({
    where: { id, deletedAt: null },
    include: {
      groups: { select: { groupId: true, group: { select: { name: true } } } },
      ownerships: {
        include: {
          employee: { select: { id: true, name: true, email: true, avatar: true } },
        },
        orderBy: { role: 'asc' },
      },
    },
  });
}

function checkReadScope(user: { isSuperAdmin: boolean; groups: { id: string }[] }, groupIds: string[]) {
  if (user.isSuperAdmin) return true;
  const userGroupIds = new Set(user.groups.map((g) => g.id));
  return groupIds.some((gid) => userGroupIds.has(gid));
}

export const GET = withAuth<{ id: string }>(
  async ({ user, params }) => {
    const channel = await loadChannelWithScope(params.id);
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh', { status: 404 });
    }

    const groupIds = channel.groups.map((g) => g.groupId);
    if (!checkReadScope(user, groupIds)) {
      return fail('FORBIDDEN', 'Kênh không thuộc nhóm của bạn', { status: 403 });
    }

    // 7 ngày gần nhất analytics
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);

    const analytics = await prisma.analytics.findMany({
      where: { channelId: channel.id, date: { gte: sevenDaysAgo } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        views: true,
        watchTimeHours: true,
        subscriberDelta: true,
        engagementRate: true,
        revenue: true,
      },
    });

    return ok({
      id: channel.id,
      name: channel.name,
      platform: channel.platform,
      status: channel.status,
      accountId: channel.accountId,
      externalUrl: channel.externalUrl,
      description: channel.description,
      category: channel.category,
      tokenExpiresAt: channel.tokenExpiresAt?.toISOString() ?? null,
      lastSyncedAt: channel.lastSyncedAt?.toISOString() ?? null,
      lastSyncError: channel.lastSyncError,
      metadata: channel.metadata,
      createdAt: channel.createdAt.toISOString(),
      updatedAt: channel.updatedAt.toISOString(),
      groups: channel.groups.map((g) => ({
        id: g.groupId,
        name: g.group.name,
      })),
      ownerships: channel.ownerships.map((o) => ({
        role: o.role,
        employeeId: o.employee.id,
        name: o.employee.name,
        email: o.employee.email,
        avatar: o.employee.avatar,
        assignedAt: o.assignedAt.toISOString(),
      })),
      recentMetrics: analytics.map((a) => ({
        date: a.date.toISOString().slice(0, 10),
        views: a.views,
        watchTimeHours: a.watchTimeHours,
        subscriberDelta: a.subscriberDelta,
        engagementRate: a.engagementRate,
        revenue: a.revenue,
      })),
    });
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);

export const PUT = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    const body = await req.json().catch(() => null);
    const parsed = updateChannelSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }

    const channel = await prisma.channel.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { groups: { select: { groupId: true } } },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh', { status: 404 });
    }

    const groupIds = channel.groups.map((g) => g.groupId);
    const canUpdate =
      user.isSuperAdmin ||
      groupIds.some(
        (gid) =>
          hasPermission(user, 'channel', 'UPDATE', { groupId: gid }) ||
          hasPermission(user, 'channel', 'FULL', { groupId: gid }),
      );
    if (!canUpdate) {
      return fail('FORBIDDEN', 'Không có quyền update kênh này', { status: 403 });
    }

    const data: Prisma.ChannelUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.externalUrl !== undefined) data.externalUrl = parsed.data.externalUrl;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.category !== undefined) data.category = parsed.data.category;
    if (parsed.data.status !== undefined) data.status = parsed.data.status;

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data,
      select: {
        id: true,
        name: true,
        platform: true,
        status: true,
        externalUrl: true,
        description: true,
        category: true,
        updatedAt: true,
      },
    });

    return ok({ ...updated, updatedAt: updated.updatedAt.toISOString() });
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);

export const DELETE = withAuth<{ id: string }>(
  async ({ user, params }) => {
    const channel = await prisma.channel.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { groups: { select: { groupId: true } } },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh', { status: 404 });
    }

    const groupIds = channel.groups.map((g) => g.groupId);
    const canDelete =
      user.isSuperAdmin ||
      groupIds.some(
        (gid) =>
          hasPermission(user, 'channel', 'DELETE', { groupId: gid }) ||
          hasPermission(user, 'channel', 'FULL', { groupId: gid }),
      );
    if (!canDelete) {
      return fail('FORBIDDEN', 'Không có quyền xoá kênh này', { status: 403 });
    }

    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        deletedAt: new Date(),
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        status: 'ARCHIVED',
      },
    });

    return noContent();
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
