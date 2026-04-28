// POST /api/v1/users/:id/deactivate — set status=SUSPENDED + terminateDate=now.
// Permission: TENANT_ADMIN+. Block self-deactivate (tránh lock-out admin cuối).
//
// Behavior:
//   - Set status=SUSPENDED, terminateDate=now
//   - KHÔNG soft delete (deletedAt vẫn null) — admin có thể restore qua
//     PATCH status='ACTIVE' (cần build endpoint riêng nếu muốn).
//   - KHÔNG xoá channelOwnerships — caller nên transfer-channels trước.
import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';

export const POST = withAuth<{ id: string }>(
  async ({ user, params }) => {
    if (!meetsRole(user, 'GROUP_ADMIN')) {
      return fail('FORBIDDEN', 'Chỉ Tenant Admin+ deactivate', { status: 403 });
    }
    if (user.id === params.id) {
      return fail('CANNOT_DEACTIVATE_SELF', 'Không thể tự deactivate', {
        status: 409,
      });
    }

    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        _count: { select: { channelOwnerships: true } },
      },
    });
    if (!target) {
      return fail('USER_NOT_FOUND', 'Không tìm thấy nhân sự', { status: 404 });
    }
    if (target.status === 'SUSPENDED') {
      return fail('ALREADY_SUSPENDED', 'Nhân sự đã SUSPENDED', { status: 409 });
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: {
        status: 'SUSPENDED',
        terminateDate: new Date(),
      },
      select: { id: true, status: true, terminateDate: true },
    });

    return ok({
      ...updated,
      terminateDate: updated.terminateDate?.toISOString() ?? null,
      warning:
        target._count.channelOwnerships > 0
          ? `User vẫn còn ${target._count.channelOwnerships} channel ownership — recommend transfer-channels trước khi deactivate.`
          : null,
    });
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);
