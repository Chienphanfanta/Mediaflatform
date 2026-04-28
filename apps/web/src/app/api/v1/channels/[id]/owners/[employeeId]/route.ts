// DELETE /api/v1/channels/:id/owners/:employeeId — gỡ ownership.
// Không cho phép xoá PRIMARY — phải transfer-primary trước (kể cả là duy nhất hay không).
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, noContent } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';

export const DELETE = withAuth<{ id: string; employeeId: string }>(
  async ({ user, params }) => {
    const channel = await prisma.channel.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { groups: { select: { groupId: true } } },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh', { status: 404 });
    }

    const groupIds = channel.groups.map((g) => g.groupId);
    const canRemove =
      user.isSuperAdmin ||
      groupIds.some(
        (gid) =>
          hasPermission(user, 'channel', 'UPDATE', { groupId: gid }) ||
          hasPermission(user, 'channel', 'FULL', { groupId: gid }),
      );
    if (!canRemove) {
      return fail('FORBIDDEN', 'Không có quyền gỡ owner kênh này', { status: 403 });
    }

    const target = await prisma.channelOwnership.findUnique({
      where: {
        channelId_employeeId: {
          channelId: channel.id,
          employeeId: params.employeeId,
        },
      },
    });
    if (!target) {
      return fail('OWNERSHIP_NOT_FOUND', 'Owner không tồn tại trong kênh này', {
        status: 404,
      });
    }

    if (target.role === 'PRIMARY') {
      return fail(
        'CANNOT_REMOVE_PRIMARY',
        'Phải transfer-primary trước khi gỡ PRIMARY owner',
        { status: 409 },
      );
    }

    await prisma.channelOwnership.delete({ where: { id: target.id } });
    return noContent();
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
