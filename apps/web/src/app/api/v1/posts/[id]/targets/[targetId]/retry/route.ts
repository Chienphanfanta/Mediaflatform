// POST /api/v1/posts/:id/targets/:targetId/retry — đưa kênh bị lỗi về hàng chờ đăng lại.
import { fail, ok } from '@/lib/api-response';
import { canManagePost, refreshPostStatus } from '@/lib/posts/access';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

export const POST = withAuth<{ id: string; targetId: string }>(async ({ params, user }) => {
  const post = await prisma.post.findFirst({ where: { id: params.id, deletedAt: null } });
  if (!post) return fail('NOT_FOUND', 'Không tìm thấy bài đăng', { status: 404 });
  if (!canManagePost(user, post)) {
    return fail('FORBIDDEN', 'Bạn không được thao tác bài này', { status: 403 });
  }

  const { count } = await prisma.postTarget.updateMany({
    where: { id: params.targetId, postId: post.id, status: { in: ['FAILED', 'CANCELLED'] } },
    data: {
      status: 'PENDING',
      errorMessage: null,
      deviceId: null,
      claimedAt: null,
      remindedAt: null,
    },
  });
  if (count === 0) {
    return fail('NOT_RETRYABLE', 'Chỉ đăng lại được kênh đang lỗi hoặc đã huỷ', { status: 409 });
  }
  if (post.status === 'DRAFT' || post.status === 'CANCELLED') {
    await prisma.post.update({ where: { id: post.id }, data: { status: 'SCHEDULED' } });
  }
  const status = await refreshPostStatus(post.id);
  return ok({ status });
});
