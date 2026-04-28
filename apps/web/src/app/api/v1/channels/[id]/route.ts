// DELETE /api/v1/channels/:id — soft delete (set deletedAt, hide from list).
// KHÔNG revoke token tại provider — đó là việc của /api/v1/platforms/:p/disconnect/:id.
// Pattern: disconnect (revoke + clear tokens) → delete (soft remove record).
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, noContent } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';

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
        // Bonus: clear tokens nếu chưa disconnect (defense in depth)
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        status: 'DISCONNECTED',
      },
    });

    return noContent();
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
