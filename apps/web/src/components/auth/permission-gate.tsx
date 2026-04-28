'use client';

// PermissionGate — render children chỉ khi user có role/permission thoả điều kiện.
//
// Có 2 modes:
//   1. minRole — check cấp độ role (VIEWER < STAFF < MANAGER < GROUP_ADMIN < SUPERADMIN)
//   2. permission — check resource:action permission từ JWT (group-scoped)
//
// Ví dụ:
//   <PermissionGate minRole="MANAGER">
//     <Button>Tạo KPI</Button>
//   </PermissionGate>
//
//   <PermissionGate permission={{ resource: 'channel', action: 'UPDATE' }}>
//     <Button>Edit channel</Button>
//   </PermissionGate>
//
// Server-side (route handler): KHÔNG dùng component này. Dùng `meetsRole(user, ...)` /
// `hasPermission(user, ...)` trực tiếp + return 403.
import type { PermissionAction } from '@prisma/client';

import { usePermission } from '@/hooks/use-permission';
import type { EffectiveRole } from '@/lib/rbac';

type Props = {
  children: React.ReactNode;
  /** Fallback render khi user thiếu quyền (default: ẩn hoàn toàn) */
  fallback?: React.ReactNode;
  /** Hiện loading state khi session đang fetch */
  loadingFallback?: React.ReactNode;
} & (
  | {
      minRole: EffectiveRole;
      permission?: never;
    }
  | {
      minRole?: never;
      permission: {
        resource: string;
        action: PermissionAction | 'FULL';
        groupId?: string;
      };
    }
);

export function PermissionGate({
  children,
  fallback = null,
  loadingFallback = null,
  minRole,
  permission,
}: Props) {
  const { atLeast, can, isLoading } = usePermission();

  if (isLoading) return <>{loadingFallback}</>;

  const allowed = minRole
    ? atLeast(minRole)
    : permission
      ? can(permission.resource, permission.action, {
          groupId: permission.groupId,
        })
      : false;

  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
