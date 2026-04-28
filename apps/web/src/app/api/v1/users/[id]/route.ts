// GET /api/v1/users/:id — chi tiết 1 nhân sự V2 stripped (no posts/tasks).
// Permission: SuperAdmin all; Manager+ chỉ xem user có ít nhất 1 group chung.
import { fail, ok } from '@/lib/api-response';
import { defaultRange, pickHighestRole } from '@/lib/hr-metrics';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import type { HRUserDetail } from '@/lib/types/hr';
import { withAuth } from '@/lib/with-auth';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ id: string }>(async ({ user, params }) => {
  if (!meetsRole(user, 'MANAGER')) {
    return fail('FORBIDDEN', 'Chỉ Manager+ xem chi tiết nhân sự', { status: 403 });
  }

  const target = await prisma.user.findFirst({
    where: { id: params.id, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      status: true,
      createdAt: true,
      groupMembers: {
        select: {
          role: true,
          group: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!target) {
    return fail('USER_NOT_FOUND', 'Không tìm thấy nhân sự', { status: 404 });
  }

  if (!user.isSuperAdmin) {
    const myEligibleGroups = user.groups
      .filter((g) => g.role === 'ADMIN' || g.role === 'MANAGER')
      .map((g) => g.id);
    const targetGroupIds = target.groupMembers.map((mb) => mb.group.id);
    const overlap = targetGroupIds.some((gid) => myEligibleGroups.includes(gid));
    if (!overlap) {
      return fail(
        'FORBIDDEN',
        'Bạn không quản lý group nào của nhân sự này',
        { status: 403 },
      );
    }
  }

  const { from, to } = defaultRange(30);
  const targetGroupIds = target.groupMembers.map((mb) => mb.group.id);

  const channels = await prisma.channel.findMany({
    where: {
      deletedAt: null,
      groups: { some: { groupId: { in: targetGroupIds } } },
    },
    select: { id: true, name: true, platform: true },
    orderBy: { name: 'asc' },
  });

  const detail: HRUserDetail = {
    id: target.id,
    name: target.name,
    email: target.email,
    avatar: target.avatar,
    status: target.status,
    primaryRole: pickHighestRole(target.groupMembers),
    createdAt: target.createdAt.toISOString(),
    groups: target.groupMembers.map((mb) => ({
      id: mb.group.id,
      name: mb.group.name,
      role: mb.role,
    })),
    rangeFrom: from.toISOString(),
    rangeTo: to.toISOString(),
    rangeDays: 30,
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      platform: c.platform,
    })),
  };

  return ok(detail);
});
