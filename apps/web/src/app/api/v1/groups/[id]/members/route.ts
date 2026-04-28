// POST /api/v1/groups/:id/members — thêm thành viên (GROUP_ADMIN+)
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { addMemberSchema } from '@/lib/schemas/group';

export const POST = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    const canManage =
      user.isSuperAdmin ||
      hasPermission(user, 'group', 'UPDATE', { groupId: params.id }) ||
      hasPermission(user, 'group', 'FULL', { groupId: params.id });

    if (!canManage) {
      return fail('FORBIDDEN', 'Bạn không có quyền quản lý thành viên group này', {
        status: 403,
      });
    }

    const group = await prisma.group.findFirst({
      where: { id: params.id, deletedAt: null },
    });
    if (!group) return fail('GROUP_NOT_FOUND', 'Không tìm thấy group', { status: 404 });

    // Chỉ SuperAdmin mới thêm được vào group SYSTEM
    if (group.type === 'SYSTEM' && !user.isSuperAdmin) {
      return fail('FORBIDDEN', 'Không thể thêm vào group hệ thống', { status: 403 });
    }

    const body = await req.json();
    const parsed = addMemberSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, deletedAt: null },
      select: { id: true, email: true, name: true, avatar: true, status: true },
    });
    if (!target) return fail('USER_NOT_FOUND', 'Không tìm thấy user', { status: 404 });

    const already = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: target.id, groupId: group.id } },
    });
    if (already) {
      return fail('ALREADY_MEMBER', 'User đã là thành viên của group này', { status: 409 });
    }

    const member = await prisma.groupMember.create({
      data: { userId: target.id, groupId: group.id, role: parsed.data.role },
      include: {
        user: { select: { id: true, email: true, name: true, avatar: true, status: true } },
      },
    });
    return ok(member, { status: 201 });
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
