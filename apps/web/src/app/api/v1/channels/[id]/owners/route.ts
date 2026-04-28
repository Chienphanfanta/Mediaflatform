// POST /api/v1/channels/:id/owners — gán employee làm PRIMARY/SECONDARY owner.
// Quy tắc PRIMARY: 1 channel chỉ có 1 PRIMARY tại 1 thời điểm. Nếu gán PRIMARY mới
// trong khi đã có PRIMARY khác → demote PRIMARY cũ thành SECONDARY (atomic).
// Để swap chủ động dùng /transfer-primary.
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';
import { assignOwnerSchema } from '@/lib/schemas/channels';

export const POST = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    const body = await req.json().catch(() => null);
    const parsed = assignOwnerSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { employeeId, role } = parsed.data;

    const channel = await prisma.channel.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { groups: { select: { groupId: true } } },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh', { status: 404 });
    }

    const groupIds = channel.groups.map((g) => g.groupId);
    const canAssign =
      user.isSuperAdmin ||
      groupIds.some(
        (gid) =>
          hasPermission(user, 'channel', 'UPDATE', { groupId: gid }) ||
          hasPermission(user, 'channel', 'FULL', { groupId: gid }),
      );
    if (!canAssign) {
      return fail('FORBIDDEN', 'Không có quyền gán owner cho kênh này', {
        status: 403,
      });
    }

    const employee = await prisma.user.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true, name: true, email: true, status: true },
    });
    if (!employee) {
      return fail('EMPLOYEE_NOT_FOUND', 'Nhân sự không tồn tại', { status: 404 });
    }
    if (employee.status !== 'ACTIVE') {
      return fail('EMPLOYEE_INACTIVE', 'Nhân sự không ACTIVE', { status: 409 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Nếu role=PRIMARY, demote PRIMARY cũ (nếu có và khác employee này)
      if (role === 'PRIMARY') {
        await tx.channelOwnership.updateMany({
          where: {
            channelId: channel.id,
            role: 'PRIMARY',
            employeeId: { not: employeeId },
          },
          data: { role: 'SECONDARY' },
        });
      }

      return tx.channelOwnership.upsert({
        where: { channelId_employeeId: { channelId: channel.id, employeeId } },
        create: {
          channelId: channel.id,
          employeeId,
          role,
          assignedById: user.id,
        },
        update: { role, assignedById: user.id, assignedAt: new Date() },
        include: {
          employee: { select: { id: true, name: true, email: true, avatar: true } },
        },
      });
    });

    return ok(
      {
        id: result.id,
        role: result.role,
        employeeId: result.employee.id,
        name: result.employee.name,
        email: result.employee.email,
        avatar: result.employee.avatar,
        assignedAt: result.assignedAt.toISOString(),
      },
      { status: 201 },
    );
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
