// RBAC helpers - edge-safe, KHÔNG import Prisma.
// Mọi dữ liệu permission đã được precompute vào JWT khi login.
// Xem CLAUDE.md §5 cho ma trận quyền.

import type { GroupType, MemberRole, PermissionAction } from '@prisma/client';

// 5 level hiệu dụng. SUPERADMIN = ADMIN của group có type = SYSTEM.
// GROUP_ADMIN = ADMIN của group non-SYSTEM.
export type EffectiveRole = 'SUPERADMIN' | 'GROUP_ADMIN' | 'MANAGER' | 'STAFF' | 'VIEWER';

export const ROLE_RANK: Record<EffectiveRole, number> = {
  VIEWER: 1,
  STAFF: 2,
  MANAGER: 3,
  GROUP_ADMIN: 4,
  SUPERADMIN: 5,
};

export type UserGroupSession = {
  id: string;
  name: string;
  type: GroupType;
  role: MemberRole;
};

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  groups: UserGroupSession[];
  // Precomputed: { [groupId]: ['post:CREATE', 'post:READ', ...] }
  permissions: Record<string, string[]>;
  isSuperAdmin: boolean;
};

// Role cao nhất của user (dùng cho route-level RBAC ở middleware).
export function getEffectiveRole(
  user: Pick<SessionUser, 'groups' | 'isSuperAdmin'> | null | undefined,
): EffectiveRole | null {
  if (!user) return null;
  if (user.isSuperAdmin) return 'SUPERADMIN';
  if (!user.groups?.length) return null;

  const rolePri: Record<MemberRole, number> = { ADMIN: 4, MANAGER: 3, STAFF: 2, VIEWER: 1 };
  const best = user.groups.reduce((a, b) => (rolePri[a.role] >= rolePri[b.role] ? a : b));
  return best.role === 'ADMIN' ? 'GROUP_ADMIN' : (best.role as EffectiveRole);
}

// Check quyền chi tiết theo (resource, action).
// Nếu truyền groupId → scope theo group đó; không thì đủ 1 group user có quyền là OK.
export function hasPermission(
  user: SessionUser | null | undefined,
  resource: string,
  action: PermissionAction | 'FULL',
  opts?: { groupId?: string },
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  const key = `${resource}:${action}`;
  const fullKey = `${resource}:FULL`;
  const check = (perms: string[] = []) => perms.includes(key) || perms.includes(fullKey);

  if (opts?.groupId) return check(user.permissions?.[opts.groupId]);
  return Object.values(user.permissions ?? {}).some(check);
}

// Role level check: user có role ≥ `min` không?
export function meetsRole(
  user: Pick<SessionUser, 'groups' | 'isSuperAdmin'> | null | undefined,
  min: EffectiveRole,
): boolean {
  const current = getEffectiveRole(user);
  if (!current) return false;
  return ROLE_RANK[current] >= ROLE_RANK[min];
}
