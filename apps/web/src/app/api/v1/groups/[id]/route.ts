// GET /api/v1/groups/:id    — chi tiết group + members (SuperAdmin hoặc thành viên)
// PUT /api/v1/groups/:id    — cập nhật group (GROUP_ADMIN+)
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { updateGroupSchema } from '@/lib/schemas/group';

export const GET = withAuth<{ id: string }>(
  async ({ user, params }) => {
    const group = await prisma.group.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        members: {
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                avatar: true,
                status: true,
              },
            },
          },
        },
        _count: { select: { channels: true } },
      },
    });

    if (!group) return fail('GROUP_NOT_FOUND', 'Không tìm thấy group', { status: 404 });

    const isMember = group.members.some((m) => m.userId === user.id);
    if (!user.isSuperAdmin && !isMember) {
      return fail('FORBIDDEN', 'Bạn không thuộc group này', { status: 403 });
    }

    return ok(group);
  },
  { rateLimit: { limit: 120, windowMs: 60_000 } },
);

export const PUT = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    // Scope theo groupId: ADMIN của group này (hoặc SuperAdmin) mới được sửa
    const canUpdate =
      user.isSuperAdmin ||
      hasPermission(user, 'group', 'UPDATE', { groupId: params.id }) ||
      hasPermission(user, 'group', 'FULL', { groupId: params.id });

    if (!canUpdate) {
      return fail('FORBIDDEN', 'Bạn không có quyền sửa group này', { status: 403 });
    }

    const existing = await prisma.group.findFirst({
      where: { id: params.id, deletedAt: null },
    });
    if (!existing) return fail('GROUP_NOT_FOUND', 'Không tìm thấy group', { status: 404 });

    // Group SYSTEM chỉ SuperAdmin được đụng tới
    if (existing.type === 'SYSTEM' && !user.isSuperAdmin) {
      return fail('FORBIDDEN', 'Group hệ thống — chỉ SuperAdmin được sửa', { status: 403 });
    }

    const body = await req.json();
    const parsed = updateGroupSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }

    const group = await prisma.group.update({
      where: { id: params.id },
      data: parsed.data,
    });
    return ok(group);
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
