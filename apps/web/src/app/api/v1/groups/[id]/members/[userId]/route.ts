// DELETE /api/v1/groups/:id/members/:userId — xoá thành viên (GROUP_ADMIN+)
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';
import { fail, noContent } from '@/lib/api-response';

export const DELETE = withAuth<{ id: string; userId: string }>(
  async ({ user, params }) => {
    const canManage =
      user.isSuperAdmin ||
      hasPermission(user, 'group', 'UPDATE', { groupId: params.id }) ||
      hasPermission(user, 'group', 'FULL', { groupId: params.id });

    if (!canManage) {
      return fail('FORBIDDEN', 'Bạn không có quyền xoá thành viên group này', {
        status: 403,
      });
    }

    const member = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: params.userId, groupId: params.id } },
      include: { group: { select: { type: true } } },
    });
    if (!member) return fail('MEMBER_NOT_FOUND', 'Không tìm thấy thành viên', { status: 404 });

    // Group SYSTEM — chỉ SuperAdmin được đụng tới
    if (member.group.type === 'SYSTEM' && !user.isSuperAdmin) {
      return fail('FORBIDDEN', 'Group hệ thống — chỉ SuperAdmin được xoá thành viên', {
        status: 403,
      });
    }

    // Chặn xoá ADMIN cuối cùng (group sẽ orphan, không ai quản lý)
    if (member.role === 'ADMIN') {
      const adminCount = await prisma.groupMember.count({
        where: { groupId: params.id, role: 'ADMIN' },
      });
      if (adminCount <= 1) {
        return fail('LAST_ADMIN', 'Không thể xoá ADMIN cuối cùng của group', { status: 409 });
      }
    }

    await prisma.groupMember.delete({
      where: { userId_groupId: { userId: params.userId, groupId: params.id } },
    });
    return noContent();
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
