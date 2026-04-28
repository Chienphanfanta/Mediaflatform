// GET  /api/v1/groups       — list (scope theo membership, SuperAdmin thấy tất cả)
// POST /api/v1/groups       — create (SuperAdmin only)
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { createGroupSchema, parsePagination } from '@/lib/schemas/group';

export const GET = withAuth(
  async ({ req, user }) => {
    const { page, pageSize } = parsePagination(new URL(req.url));

    const where: Prisma.GroupWhereInput = {
      deletedAt: null,
      ...(user.isSuperAdmin ? {} : { members: { some: { userId: user.id } } }),
    };

    const [items, total] = await Promise.all([
      prisma.group.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          type: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { members: true, channels: true } },
        },
      }),
      prisma.group.count({ where }),
    ]);

    return ok(items, {
      meta: {
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      },
    });
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);

export const POST = withAuth(
  async ({ req, user }) => {
    if (!user.isSuperAdmin) {
      return fail('FORBIDDEN', 'Chỉ SuperAdmin được tạo group mới', { status: 403 });
    }

    const body = await req.json();
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }

    const group = await prisma.group.create({ data: parsed.data });
    return ok(group, { status: 201 });
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
