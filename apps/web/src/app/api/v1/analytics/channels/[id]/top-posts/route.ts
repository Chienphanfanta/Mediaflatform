// GET /api/v1/analytics/channels/:id/top-posts?limit=10&sortBy=views&period=7d
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { getTopPosts } from '@/lib/analytics-service';
import { topPostsQuerySchema } from '@/lib/schemas/analytics';

export const GET = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    const url = new URL(req.url);
    const parsed = topPostsQuerySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
      sortBy: url.searchParams.get('sortBy') ?? undefined,
      period: url.searchParams.get('period') ?? undefined,
    });
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Query không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }

    // Check channel access
    const userGroupIds = user.groups.map((g) => g.id);
    const channel = await prisma.channel.findFirst({
      where: user.isSuperAdmin
        ? { id: params.id, deletedAt: null }
        : {
            id: params.id,
            deletedAt: null,
            groups: { some: { groupId: { in: userGroupIds } } },
          },
      select: { id: true },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh hoặc không có quyền', {
        status: 404,
      });
    }

    const { limit, sortBy, period } = parsed.data;
    const result = await getTopPosts(params.id, limit, sortBy, period);

    return ok(result);
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
