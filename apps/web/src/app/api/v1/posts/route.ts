// GET  /api/v1/posts — danh sách bài đăng (lọc status/platform/mine, phân trang)
// POST /api/v1/posts — tạo bài + 1 PostTarget cho mỗi kênh đích
import type { Prisma } from '@prisma/client';

import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import {
  POST_INCLUDE,
  PostValidationError,
  serializePost,
  validatePostInput,
  visiblePostWhere,
} from '@/lib/posts/service';
import { createPostSchema, listPostsQuerySchema } from '@/lib/schemas/posts';
import { withAuth } from '@/lib/with-auth';

export const GET = withAuth(async ({ req, user }) => {
  const url = new URL(req.url);
  const q = listPostsQuerySchema.parse(Object.fromEntries(url.searchParams));

  const where: Prisma.PostWhereInput = { AND: [visiblePostWhere(user)] };
  const and = where.AND as Prisma.PostWhereInput[];
  if (q.status) and.push({ status: q.status });
  if (q.platform) and.push({ targets: { some: { channel: { platform: q.platform } } } });
  if (q.mine) and.push({ createdById: user.id });

  const [total, rows] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      include: POST_INCLUDE,
      orderBy: [{ scheduledAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  const items = await Promise.all(rows.map((p) => serializePost(p)));
  const pagination = {
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
  };
  return ok({ items, pagination }, { meta: { pagination } });
});

export const POST = withAuth(
  async ({ req, user }) => {
    if (!meetsRole(user, 'STAFF')) {
      return fail('FORBIDDEN', 'Bạn không có quyền đăng bài', { status: 403 });
    }
    const parsed = createPostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Dữ liệu bài đăng không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;

    try {
      await validatePostInput(user, d);
    } catch (e) {
      if (e instanceof PostValidationError) {
        return fail(e.code, e.message, { status: e.status });
      }
      throw e;
    }

    const channelIds = Array.from(new Set(d.channelIds));
    const mediaIds = Array.from(new Set(d.mediaIds));
    const created = await prisma.post.create({
      data: {
        tenantId: user.tenantId,
        createdById: user.id,
        title: d.title ?? null,
        caption: d.caption,
        hashtags: d.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)),
        scheduledAt: d.scheduledAt ?? null,
        status: d.draft ? 'DRAFT' : 'SCHEDULED',
        media: { create: mediaIds.map((mediaId, order) => ({ mediaId, order })) },
        // Nested create: tenant extension không inject tenantId → truyền tay
        targets: {
          create: channelIds.map((channelId) => ({
            tenantId: user.tenantId,
            channelId,
            options: d.options ?? undefined,
          })),
        },
      },
      include: POST_INCLUDE,
    });

    return ok(await serializePost(created), { status: 201 });
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
