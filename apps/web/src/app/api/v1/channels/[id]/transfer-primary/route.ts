// POST /api/v1/channels/:id/transfer-primary — chuyển PRIMARY ownership.
// Body: { newPrimaryEmployeeId }
//
// Logic atomic:
//   1. Demote PRIMARY hiện tại thành SECONDARY (nếu khác newPrimary).
//   2. Upsert newPrimary thành PRIMARY (nếu chưa có ownership thì tạo mới).
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';
import { transferPrimarySchema } from '@/lib/schemas/channels';

export const POST = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    const body = await req.json().catch(() => null);
    const parsed = transferPrimarySchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { newPrimaryEmployeeId } = parsed.data;

    const channel = await prisma.channel.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { groups: { select: { groupId: true } } },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh', { status: 404 });
    }

    const groupIds = channel.groups.map((g) => g.groupId);
    const canTransfer =
      user.isSuperAdmin ||
      groupIds.some(
        (gid) =>
          hasPermission(user, 'channel', 'UPDATE', { groupId: gid }) ||
          hasPermission(user, 'channel', 'FULL', { groupId: gid }),
      );
    if (!canTransfer) {
      return fail('FORBIDDEN', 'Không có quyền transfer kênh này', {
        status: 403,
      });
    }

    const newPrimary = await prisma.user.findFirst({
      where: { id: newPrimaryEmployeeId, deletedAt: null },
      select: { id: true, name: true, email: true, avatar: true, status: true },
    });
    if (!newPrimary) {
      return fail('EMPLOYEE_NOT_FOUND', 'Nhân sự đích không tồn tại', {
        status: 404,
      });
    }
    if (newPrimary.status !== 'ACTIVE') {
      return fail('EMPLOYEE_INACTIVE', 'Nhân sự đích không ACTIVE', {
        status: 409,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Demote tất cả PRIMARY hiện tại (≠ new) → SECONDARY
      await tx.channelOwnership.updateMany({
        where: {
          channelId: channel.id,
          role: 'PRIMARY',
          employeeId: { not: newPrimaryEmployeeId },
        },
        data: { role: 'SECONDARY' },
      });

      // Upsert new primary
      return tx.channelOwnership.upsert({
        where: {
          channelId_employeeId: {
            channelId: channel.id,
            employeeId: newPrimaryEmployeeId,
          },
        },
        create: {
          channelId: channel.id,
          employeeId: newPrimaryEmployeeId,
          role: 'PRIMARY',
          assignedById: user.id,
        },
        update: { role: 'PRIMARY', assignedById: user.id, assignedAt: new Date() },
        include: {
          employee: { select: { id: true, name: true, email: true, avatar: true } },
        },
      });
    });

    return ok({
      role: result.role,
      employeeId: result.employee.id,
      name: result.employee.name,
      email: result.employee.email,
      avatar: result.employee.avatar,
      assignedAt: result.assignedAt.toISOString(),
    });
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
