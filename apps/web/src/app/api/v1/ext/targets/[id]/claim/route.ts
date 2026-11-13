// POST /api/v1/ext/targets/:id/claim — trình duyệt nhận việc đăng 1 target.
// Atomic: updateMany với điều kiện status=PENDING → chỉ 1 máy claim thành công.
import { fail, ok } from '@/lib/api-response';
import { refreshPostStatus } from '@/lib/posts/access';
import { withDevice } from '@/lib/posts/device-auth';
import { prisma } from '@/lib/prisma';

export const POST = withDevice<{ id: string }>(async ({ params, device }) => {
  const now = new Date();
  const { count } = await prisma.postTarget.updateMany({
    where: {
      id: params.id,
      status: 'PENDING',
      channel: { ownerships: { some: { employeeId: device.userId } } },
      post: {
        deletedAt: null,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
      },
    },
    data: {
      status: 'PUBLISHING',
      deviceId: device.id,
      claimedAt: now,
      attempts: { increment: 1 },
    },
  });
  if (count === 0) {
    return fail('ALREADY_CLAIMED', 'Bài này đã được máy khác nhận hoặc không còn chờ đăng', {
      status: 409,
    });
  }

  const target = await prisma.postTarget.findUnique({
    where: { id: params.id },
    select: { id: true, postId: true, attempts: true, claimedAt: true },
  });
  if (target) await refreshPostStatus(target.postId);
  return ok(target);
});
