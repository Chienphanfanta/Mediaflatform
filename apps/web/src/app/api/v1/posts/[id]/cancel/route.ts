// POST /api/v1/posts/:id/cancel — huỷ đăng các kênh chưa đăng (PENDING → CANCELLED).
// Kênh đang đăng (PUBLISHING) không huỷ được vì extension đã thao tác trên trình duyệt.
import { fail, ok } from '@/lib/api-response';
import { canManagePost, refreshPostStatus } from '@/lib/posts/access';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

export const POST = withAuth<{ id: string }>(async ({ params, user }) => {
  const post = await prisma.post.findFirst({ where: { id: params.id, deletedAt: null } });
  if (!post) return fail('NOT_FOUND', 'Không tìm thấy bài đăng', { status: 404 });
  if (!canManagePost(user, post)) {
    return fail('FORBIDDEN', 'Bạn không được huỷ bài này', { status: 403 });
  }

  const { count } = await prisma.postTarget.updateMany({
    where: { postId: post.id, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
  const status = await refreshPostStatus(post.id);
  return ok({ cancelledTargets: count, status });
});
