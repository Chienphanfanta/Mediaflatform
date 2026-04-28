// Client hook: đọc session từ NextAuth + expose API check quyền.
// Sử dụng:
//   const { can, is, atLeast, user } = usePermission();
//   {can('post', 'CREATE') && <Button>Tạo bài</Button>}
//   {atLeast('MANAGER') && <AdminPanel />}
'use client';

import { useSession } from 'next-auth/react';
import type { PermissionAction } from '@prisma/client';
import {
  getEffectiveRole,
  hasPermission,
  meetsRole,
  type EffectiveRole,
  type SessionUser,
} from '@/lib/rbac';

export function usePermission() {
  const { data: session, status } = useSession();
  const user = (session?.user ?? null) as SessionUser | null;

  return {
    user,
    status,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
    effectiveRole: getEffectiveRole(user),

    can(
      resource: string,
      action: PermissionAction | 'FULL',
      opts?: { groupId?: string },
    ): boolean {
      return hasPermission(user, resource, action, opts);
    },

    is(role: EffectiveRole): boolean {
      return getEffectiveRole(user) === role;
    },

    atLeast(role: EffectiveRole): boolean {
      return meetsRole(user, role);
    },
  };
}
