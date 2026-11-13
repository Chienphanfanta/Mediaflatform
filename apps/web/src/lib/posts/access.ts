// Quyền đăng bài theo kênh + tính trạng thái tổng của Post.
import type { PostStatus, PostTargetStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getEffectiveRole, type SessionUser } from '@/lib/rbac';

/**
 * Kênh mà user được phép GIAO bài đăng (trên web):
 * - SUPERADMIN / GROUP_ADMIN: mọi kênh trong tenant
 * - MANAGER: kênh thuộc group mình làm MANAGER/ADMIN + kênh mình phụ trách
 * - STAFF: chỉ kênh mình phụ trách (ChannelOwnership)
 * - VIEWER: không có
 */
export function postableChannelWhere(user: SessionUser): Prisma.ChannelWhereInput | null {
  const role = getEffectiveRole(user);
  const base: Prisma.ChannelWhereInput = { deletedAt: null, status: { not: 'ARCHIVED' } };
  if (role === 'SUPERADMIN' || role === 'GROUP_ADMIN') return base;
  if (role === 'MANAGER') {
    const managedGroupIds = user.groups
      .filter((g) => g.role === 'MANAGER' || g.role === 'ADMIN')
      .map((g) => g.id);
    return {
      ...base,
      OR: [
        { groups: { some: { groupId: { in: managedGroupIds } } } },
        { ownerships: { some: { employeeId: user.id } } },
      ],
    };
  }
  if (role === 'STAFF') {
    return { ...base, ownerships: { some: { employeeId: user.id } } };
  }
  return null;
}

/** Trả danh sách channelId KHÔNG được phép trong `channelIds` (rỗng = OK). */
export async function findForbiddenChannels(
  user: SessionUser,
  channelIds: string[],
): Promise<string[]> {
  const where = postableChannelWhere(user);
  if (!where) return channelIds;
  const allowed = await prisma.channel.findMany({
    where: { AND: [where, { id: { in: channelIds } }] },
    select: { id: true },
  });
  const ok = new Set(allowed.map((c) => c.id));
  return channelIds.filter((id) => !ok.has(id));
}

/** User có được sửa/xoá bài không: người tạo hoặc MANAGER trở lên. */
export function canManagePost(user: SessionUser, post: { createdById: string }): boolean {
  if (post.createdById === user.id) return true;
  const role = getEffectiveRole(user);
  return role === 'SUPERADMIN' || role === 'GROUP_ADMIN' || role === 'MANAGER';
}

/** Tính trạng thái tổng của Post từ trạng thái các target. */
export function aggregatePostStatus(
  current: PostStatus,
  targets: Array<{ status: PostTargetStatus }>,
): PostStatus {
  if (current === 'DRAFT' || current === 'CANCELLED') return current;
  const active = targets.filter((t) => t.status !== 'CANCELLED');
  if (active.length === 0) return 'CANCELLED';
  const count = (s: PostTargetStatus) => active.filter((t) => t.status === s).length;
  const published = count('PUBLISHED');
  const failed = count('FAILED');
  const publishing = count('PUBLISHING');
  if (published === active.length) return 'PUBLISHED';
  if (failed === active.length) return 'FAILED';
  if (published + failed === active.length) return 'PARTIAL';
  if (publishing > 0 || published > 0 || failed > 0) return 'PUBLISHING';
  return 'SCHEDULED';
}

/** Đồng bộ lại Post.status sau khi target thay đổi. Phải gọi trong tenant context. */
export async function refreshPostStatus(postId: string): Promise<PostStatus | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { status: true, targets: { select: { status: true } } },
  });
  if (!post) return null;
  const next = aggregatePostStatus(post.status, post.targets);
  if (next !== post.status) {
    await prisma.post.update({ where: { id: postId }, data: { status: next } });
  }
  return next;
}
