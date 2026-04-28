// GET /api/v1/users — list users scope theo group user là MANAGER/ADMIN.
// SuperAdmin xem all. STAFF/VIEWER → 403 (route page cũng bị middleware gate).
// V2 stripped: bỏ posts/tasks/kpi aggregate (Sprint 6 thêm KPI assignments).
import { Prisma } from '@prisma/client';

import { fail, ok } from '@/lib/api-response';
import { pickHighestRole } from '@/lib/hr-metrics';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import type { HRUserListItem } from '@/lib/types/hr';
import { withAuth } from '@/lib/with-auth';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async ({ req, user }) => {
  if (!meetsRole(user, 'MANAGER')) {
    return fail('FORBIDDEN', 'Chỉ Manager+ truy cập danh sách nhân sự', {
      status: 403,
    });
  }

  const url = new URL(req.url);
  const groupFilter = url.searchParams.get('groupId');
  const roleFilter = url.searchParams.get('role');

  const eligibleGroupIds = user.isSuperAdmin
    ? null
    : user.groups
        .filter((g) => g.role === 'ADMIN' || g.role === 'MANAGER')
        .map((g) => g.id);

  if (eligibleGroupIds !== null && eligibleGroupIds.length === 0) {
    return ok({ items: [], total: 0 });
  }

  if (groupFilter && eligibleGroupIds && !eligibleGroupIds.includes(groupFilter)) {
    return fail('FORBIDDEN', 'Bạn không quản lý group này', { status: 403 });
  }

  const memberWhere: Prisma.GroupMemberWhereInput = {};
  if (groupFilter) memberWhere.groupId = groupFilter;
  else if (eligibleGroupIds) memberWhere.groupId = { in: eligibleGroupIds };
  if (roleFilter && ['ADMIN', 'MANAGER', 'STAFF', 'VIEWER'].includes(roleFilter)) {
    memberWhere.role = roleFilter as Prisma.GroupMemberWhereInput['role'];
  }

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      groupMembers: { some: memberWhere },
    },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      status: true,
      groupMembers: {
        select: {
          role: true,
          group: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const items: HRUserListItem[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    status: u.status,
    primaryRole: pickHighestRole(u.groupMembers),
    groups: u.groupMembers.map((mb) => ({
      id: mb.group.id,
      name: mb.group.name,
      role: mb.role,
    })),
  }));

  return ok({ items, total: items.length });
});
