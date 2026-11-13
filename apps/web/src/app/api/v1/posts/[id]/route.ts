// GET    /api/v1/posts/:id — chi tiết bài (kèm previewUrl media)
// PATCH  /api/v1/posts/:id — sửa bài (chỉ khi chưa có kênh nào đang/đã đăng)
// DELETE /api/v1/posts/:id — xoá mềm + huỷ các target chưa đăng
import { fail, noContent, ok } from '@/lib/api-response';
import { canManagePost } from '@/lib/posts/access';
import {
  POST_INCLUDE,
  PostValidationError,
  serializePost,
  validatePostInput,
  visiblePostWhere,
} from '@/lib/posts/service';
import { prisma } from '@/lib/prisma';
import { updatePostSchema } from '@/lib/schemas/posts';
import { withAuth } from '@/lib/with-auth';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  const post = await prisma.post.findFirst({
    where: { AND: [{ id: params.id }, visiblePostWhere(user)] },
    include: POST_INCLUDE,
  });
  if (!post) return fail('NOT_FOUND', 'Không tìm thấy bài đăng', { status: 404 });
  return ok(await serializePost(post, true));
});

export const PATCH = withAuth<{ id: string }>(
  async ({ req, params, user }) => {
    const post = await prisma.post.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { targets: { select: { channelId: true, status: true } }, media: true },
    });
    if (!post) return fail('NOT_FOUND', 'Không tìm thấy bài đăng', { status: 404 });
    if (!canManagePost(user, post)) {
      return fail('FORBIDDEN', 'Bạn không được sửa bài này', { status: 403 });
    }
    if (post.targets.some((t) => t.status === 'PUBLISHING' || t.status === 'PUBLISHED')) {
      return fail('POST_LOCKED', 'Bài đã/đang được đăng ở ít nhất 1 kênh, không sửa được', {
        status: 409,
      });
    }

    const parsed = updatePostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Dữ liệu bài đăng không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;

    const channelIds = d.channelIds
      ? Array.from(new Set(d.channelIds))
      : post.targets.filter((t) => t.status !== 'CANCELLED').map((t) => t.channelId);
    const mediaIds = d.mediaIds
      ? Array.from(new Set(d.mediaIds))
      : post.media.sort((a, b) => a.order - b.order).map((m) => m.mediaId);
    const title = d.title !== undefined ? d.title : post.title;

    try {
      await validatePostInput(user, { channelIds, mediaIds, title });
    } catch (e) {
      if (e instanceof PostValidationError) return fail(e.code, e.message, { status: e.status });
      throw e;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (d.mediaIds) {
        await tx.postMedia.deleteMany({ where: { postId: post.id } });
        await tx.postMedia.createMany({
          data: mediaIds.map((mediaId, order) => ({ postId: post.id, mediaId, order })),
        });
      }
      if (d.channelIds || d.options) {
        // Chưa có target nào đăng → làm lại toàn bộ target
        await tx.postTarget.deleteMany({ where: { postId: post.id } });
        await tx.postTarget.createMany({
          data: channelIds.map((channelId) => ({
            tenantId: post.tenantId,
            postId: post.id,
            channelId,
            options: d.options ?? undefined,
          })),
        });
      } else {
        // Reset trạng thái lỗi/huỷ để đăng lại theo nội dung mới
        await tx.postTarget.updateMany({
          where: { postId: post.id },
          data: { status: 'PENDING', errorMessage: null, remindedAt: null },
        });
      }
      return tx.post.update({
        where: { id: post.id },
        data: {
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.caption !== undefined ? { caption: d.caption } : {}),
          ...(d.hashtags
            ? { hashtags: d.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)) }
            : {}),
          ...(d.scheduledAt !== undefined ? { scheduledAt: d.scheduledAt } : {}),
          ...(d.draft !== undefined ? { status: d.draft ? 'DRAFT' : 'SCHEDULED' } : {}),
        },
        include: POST_INCLUDE,
      });
    });

    return ok(await serializePost(updated, true));
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);

export const DELETE = withAuth<{ id: string }>(async ({ params, user }) => {
  const post = await prisma.post.findFirst({
    where: { id: params.id, deletedAt: null },
    include: { targets: { select: { status: true } } },
  });
  if (!post) return fail('NOT_FOUND', 'Không tìm thấy bài đăng', { status: 404 });
  if (!canManagePost(user, post)) {
    return fail('FORBIDDEN', 'Bạn không được xoá bài này', { status: 403 });
  }
  if (post.targets.some((t) => t.status === 'PUBLISHING')) {
    return fail('POST_PUBLISHING', 'Bài đang được đăng, thử lại sau ít phút', { status: 409 });
  }

  await prisma.$transaction([
    prisma.postTarget.updateMany({
      where: { postId: post.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    }),
    prisma.post.update({ where: { id: post.id }, data: { deletedAt: new Date() } }),
  ]);
  return noContent();
});
