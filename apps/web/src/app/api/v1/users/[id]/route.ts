// GET    /api/v1/users/:id — chi tiết với department + ownedChannels + groups
// PATCH  /api/v1/users/:id — update profile (name/phone/position/avatar/dept/joinDate)
//
// Permission: SuperAdmin all; Manager+ chỉ xem user có ít nhất 1 group chung.
// PATCH: TENANT_ADMIN+ hoặc người ấy chính chủ (self-edit).
import { fail, ok } from '@/lib/api-response';
import { defaultRange, pickHighestRole } from '@/lib/hr-metrics';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { updateEmployeeSchema } from '@/lib/schemas/employees';
import type { HRUserDetail } from '@/lib/types/hr';
import { withAuth } from '@/lib/with-auth';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ id: string }>(async ({ user, params }) => {
  // Cho phép self-read (xem profile của mình); else MANAGER+
  const isSelf = user.id === params.id;
  if (!isSelf && !meetsRole(user, 'MANAGER')) {
    return fail('FORBIDDEN', 'Chỉ Manager+ xem chi tiết nhân sự khác', { status: 403 });
  }

  const target = await prisma.user.findFirst({
    where: { id: params.id, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      phone: true,
      position: true,
      joinDate: true,
      terminateDate: true,
      status: true,
      createdAt: true,
      department: { select: { id: true, name: true, color: true } },
      groupMembers: {
        select: {
          role: true,
          group: { select: { id: true, name: true } },
        },
      },
      channelOwnerships: {
        include: {
          channel: { select: { id: true, name: true, platform: true } },
        },
      },
    },
  });
  if (!target) {
    return fail('USER_NOT_FOUND', 'Không tìm thấy nhân sự', { status: 404 });
  }

  if (!isSelf && !user.isSuperAdmin) {
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
    phone: target.phone,
    position: target.position,
    joinDate: target.joinDate?.toISOString() ?? null,
    terminateDate: target.terminateDate?.toISOString() ?? null,
    status: target.status,
    primaryRole: pickHighestRole(target.groupMembers),
    createdAt: target.createdAt.toISOString(),
    department: target.department,
    groups: target.groupMembers.map((mb) => ({
      id: mb.group.id,
      name: mb.group.name,
      role: mb.role,
    })),
    rangeFrom: from.toISOString(),
    rangeTo: to.toISOString(),
    rangeDays: 30,
    ownedChannels: target.channelOwnerships.map((o) => ({
      id: o.channel.id,
      name: o.channel.name,
      platform: o.channel.platform,
      role: o.role,
    })),
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      platform: c.platform,
    })),
  };

  return ok(detail);
});

export const PATCH = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    const isSelf = user.id === params.id;
    if (!isSelf && !meetsRole(user, 'GROUP_ADMIN')) {
      return fail('FORBIDDEN', 'Chỉ Tenant Admin+ update profile người khác', {
        status: 403,
      });
    }

    const body = await req.json().catch(() => null);
    const parsed = updateEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;

    // Verify dept (nếu có)
    if (d.departmentId !== undefined && d.departmentId !== null) {
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

    try {
      const updated = await prisma.user.update({
        where: { id: params.id, deletedAt: null },
        data: {
          ...(d.name !== undefined && { name: d.name }),
          ...(d.phone !== undefined && { phone: d.phone }),
          ...(d.position !== undefined && { position: d.position }),
          ...(d.avatar !== undefined && { avatar: d.avatar }),
          ...(d.departmentId !== undefined && { departmentId: d.departmentId }),
          ...(d.joinDate !== undefined && { joinDate: d.joinDate }),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          position: true,
          avatar: true,
          status: true,
          department: { select: { id: true, name: true, color: true } },
        },
      });
      return ok(updated);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') {
        return fail('USER_NOT_FOUND', 'Không tìm thấy nhân sự', { status: 404 });
      }
      throw e;
    }
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
