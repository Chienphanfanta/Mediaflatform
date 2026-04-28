// GET /api/v1/users — list users scope theo group user là MANAGER/ADMIN.
//   ?expand=full → kèm department + channelsCount + kpiAvg (Day 9 list view)
// POST /api/v1/users — create employee (TENANT_ADMIN+).
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { fail, ok } from '@/lib/api-response';
import { pickHighestRole } from '@/lib/hr-metrics';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { createEmployeeSchema } from '@/lib/schemas/employees';
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
  const departmentFilter = url.searchParams.get('departmentId');
  const statusFilter = url.searchParams.get('status');
  const expand = url.searchParams.get('expand') === 'full';

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

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    groupMembers: { some: memberWhere },
  };
  if (departmentFilter) where.departmentId = departmentFilter;
  if (statusFilter && ['ACTIVE', 'SUSPENDED', 'INVITED'].includes(statusFilter)) {
    where.status = statusFilter as Prisma.UserWhereInput['status'];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      phone: true,
      position: true,
      status: true,
      joinDate: true,
      department: expand
        ? { select: { id: true, name: true, color: true } }
        : false,
      groupMembers: {
        select: {
          role: true,
          group: { select: { id: true, name: true } },
        },
      },
      ...(expand && {
        channelOwnerships: {
          select: {
            role: true,
            channel: { select: { id: true, name: true, platform: true } },
          },
        },
      }),
    },
    orderBy: { name: 'asc' },
  });

  // Optional: KPI average per user (chỉ khi expand=full)
  let kpiByUser = new Map<string, number | null>();
  if (expand && users.length > 0) {
    const kpis = await prisma.kPI.findMany({
      where: {
        employeeId: { in: users.map((u) => u.id) },
        achievementPercent: { not: null },
      },
      select: { employeeId: true, achievementPercent: true },
    });
    const sum = new Map<string, { total: number; count: number }>();
    for (const k of kpis) {
      const cur = sum.get(k.employeeId) ?? { total: 0, count: 0 };
      cur.total += k.achievementPercent ?? 0;
      cur.count += 1;
      sum.set(k.employeeId, cur);
    }
    kpiByUser = new Map(
      Array.from(sum.entries()).map(([id, { total, count }]) => [
        id,
        Math.round((total / count) * 100) / 100,
      ]),
    );
  }

  const items = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    phone: u.phone,
    position: u.position,
    status: u.status,
    joinDate: u.joinDate?.toISOString() ?? null,
    primaryRole: pickHighestRole(u.groupMembers),
    groups: u.groupMembers.map((mb) => ({
      id: mb.group.id,
      name: mb.group.name,
      role: mb.role,
    })),
    ...(expand && {
      department: u.department ?? null,
      channels:
        ('channelOwnerships' in u
          ? (u as unknown as {
              channelOwnerships: Array<{
                role: string;
                channel: { id: string; name: string; platform: string };
              }>;
            }).channelOwnerships
          : []
        ).map((o) => ({
          id: o.channel.id,
          name: o.channel.name,
          platform: o.channel.platform,
          role: o.role,
        })),
      kpiAvgAchievement: kpiByUser.get(u.id) ?? null,
    }),
  }));

  return ok({ items, total: items.length });
});

export const POST = withAuth(
  async ({ req, user }) => {
    if (!meetsRole(user, 'GROUP_ADMIN')) {
      return fail('FORBIDDEN', 'Chỉ Tenant Admin+ tạo nhân sự', { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = createEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;

    // Verify dept (nếu có)
    if (d.departmentId) {
      const dep = await prisma.department.findUnique({
        where: { id: d.departmentId },
        select: { id: true },
      });
      if (!dep) {
        return fail('DEPARTMENT_NOT_FOUND', 'Phòng ban không tồn tại', {
          status: 404,
        });
      }
    }

    const passwordHash = await bcrypt.hash(d.password, 10);

    try {
      const created = await prisma.user.create({
        data: {
          tenantId: user.tenantId,
          email: d.email,
          password: passwordHash,
          name: d.name,
          phone: d.phone ?? null,
          position: d.position ?? null,
          avatar: d.avatar ?? null,
          departmentId: d.departmentId ?? null,
          joinDate: d.joinDate ?? new Date(),
          status: 'ACTIVE',
          groupMembers: d.groupMemberships
            ? {
                create: d.groupMemberships.map((m) => ({
                  groupId: m.groupId,
                  role: m.role,
                })),
              }
            : undefined,
        },
        select: {
          id: true,
          email: true,
          name: true,
          position: true,
          status: true,
        },
      });

      return ok(created, { status: 201 });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        return fail('EMAIL_DUPLICATE', 'Email đã tồn tại trong tenant', {
          status: 409,
        });
      }
      throw e;
    }
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
