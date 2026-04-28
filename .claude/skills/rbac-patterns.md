# RBAC Patterns — 5 levels, 3 layers

> 5 level: `SUPERADMIN` > `GROUP_ADMIN` > `MANAGER` > `STAFF` > `VIEWER`.
> SuperAdmin = ADMIN của group có `type = SYSTEM`. Xem CLAUDE.md §5.

---

## 1. Kiến trúc — 3 layers check

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Middleware (edge)                                  │
│  auth.config.ts → authorized() callback                     │
│  Chặn NGAY URL nếu thiếu role. Không query DB.              │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Server (route handler / server component)          │
│  auth() → session.user → hasPermission(user, resource, ...) │
│  Chi tiết theo resource + action + groupId.                 │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Client (UI)                                        │
│  usePermission() → can(), atLeast(), is()                   │
│  Ẩn/hiện button, nav item. KHÔNG thay check server.         │
└─────────────────────────────────────────────────────────────┘
```

**Quan trọng**: client check chỉ để UX. Bảo mật thật ở server.

---

## 2. Session shape — có gì trong JWT

Xem [types/next-auth.d.ts](../../apps/web/src/types/next-auth.d.ts):

```ts
session.user = {
  id: string;
  email, name, image,
  groups: Array<{ id, name, type: GroupType, role: MemberRole }>,
  permissions: Record<groupId, Array<`${resource}:${action}`>>,  // precomputed
  isSuperAdmin: boolean,
};
```

`permissions` được precompute tại [auth.ts](../../apps/web/src/auth.ts) khi login → embed vào JWT. Mọi check sau đó không cần DB.

---

## 3. Server — `hasPermission()` trong route handler

```ts
import { hasPermission } from '@/lib/rbac';

export const PATCH = withAuth<{ id: string }>(async ({ req, user, params }) => {
  const post = await prisma.post.findFirst({
    where: { id: params.id, deletedAt: null },
    include: { channel: { include: { groups: { select: { groupId: true } } } } },
  });
  if (!post) return fail('POST_NOT_FOUND', '...', { status: 404 });

  // Check theo TỪNG group mà channel thuộc về
  const groupIds = post.channel.groups.map((g) => g.groupId);
  const canUpdate =
    user.isSuperAdmin ||
    post.authorId === user.id ||                                      // author bypass
    groupIds.some((gid) => hasPermission(user, 'post', 'UPDATE', { groupId: gid })) ||
    groupIds.some((gid) => hasPermission(user, 'post', 'FULL', { groupId: gid }));

  if (!canUpdate) return fail('FORBIDDEN', '...', { status: 403 });

  // ... update
});
```

Ví dụ thực tế: [api/v1/posts/[id]/route.ts](../../apps/web/src/app/api/v1/posts/[id]/route.ts).

### Quy tắc

1. **Kiểm `isSuperAdmin` trước** → bypass.
2. **Scope theo groupId** khi resource thuộc về 1 group cụ thể.
3. **Check cả `FULL`** action — ADMIN có `{resource}:FULL` chứ không phải mọi CRUD.
4. **Author bypass** (optional) — cho phép user sửa bài của chính mình kể cả khi không có permission.
5. **Không so sánh theo `role.level`** — sẽ vỡ khi thêm custom role.

```ts
// ❌ SAI
if (user.groups[0].role !== 'ADMIN') throw Forbidden;

// ✅ ĐÚNG
if (!hasPermission(user, 'channel', 'UPDATE', { groupId })) throw Forbidden;
```

---

## 4. Server — scope data theo group

Mọi query (trừ SuperAdmin) phải scope:

```ts
const groupIds = user.groups.map((g) => g.id);

const channelWhere: Prisma.ChannelWhereInput = user.isSuperAdmin
  ? { deletedAt: null }
  : { deletedAt: null, groups: { some: { groupId: { in: groupIds } } } };

const channels = await prisma.channel.findMany({ where: channelWhere });
```

Pattern: chỉ cần `user.groups.some((g) => g.id === targetGroupId)` để biết user có trong group đó, nhưng `hasPermission(..., { groupId })` chính xác hơn vì còn check permission cụ thể.

---

## 5. Middleware — route-level RBAC

File: [auth.config.ts](../../apps/web/src/auth.config.ts). Khai báo minRole cho từng URL prefix:

```ts
const ROUTE_RBAC: Array<{ pattern: RegExp; minRole: EffectiveRole }> = [
  { pattern: /^\/admin(\/|$)/, minRole: 'SUPERADMIN' },
  { pattern: /^\/settings(\/|$)/, minRole: 'GROUP_ADMIN' },
  { pattern: /^\/hr(\/|$)/, minRole: 'MANAGER' },
  { pattern: /^\/reports(\/|$)/, minRole: 'MANAGER' },
  { pattern: /^\/channels(\/|$)/, minRole: 'STAFF' },
  { pattern: /^\/calendar(\/|$)/, minRole: 'STAFF' },
  { pattern: /^\/analytics(\/|$)/, minRole: 'VIEWER' },
  { pattern: /^\/dashboard(\/|$)/, minRole: 'VIEWER' },
];

callbacks: {
  authorized({ auth, request }) {
    const { pathname } = request.nextUrl;
    if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
    if (!auth?.user) return false;                          // → redirect /login
    const match = ROUTE_RBAC.find((r) => r.pattern.test(pathname));
    if (!match) return true;
    if (meetsRole(auth.user, match.minRole)) return true;
    return NextResponse.redirect(new URL('/forbidden', request.url));
  },
}
```

Thêm route mới:
1. Thêm entry vào `ROUTE_RBAC` (với minRole).
2. Thêm entry tương ứng vào [nav-items.tsx](../../apps/web/src/components/dashboard/nav-items.tsx) (UI nav).
3. Server component page tự `await auth()` nếu cần user.

---

## 6. Client — `usePermission()` hook

File: [hooks/use-permission.ts](../../apps/web/src/hooks/use-permission.ts).

```tsx
'use client';
import { usePermission } from '@/hooks/use-permission';

export function MyComponent() {
  const { user, can, is, atLeast, effectiveRole, isLoading } = usePermission();

  if (isLoading) return <Skeleton />;

  return (
    <div>
      {/* Ẩn/hiện button theo permission cụ thể */}
      {can('post', 'CREATE') && <Button>+ Tạo bài</Button>}

      {/* Scope theo group */}
      {can('channel', 'UPDATE', { groupId: 'xxx' }) && <EditButton />}

      {/* Ẩn/hiện section theo role level */}
      {atLeast('MANAGER') && <AnalyticsSection />}

      {/* Exact role check */}
      {is('SUPERADMIN') && <DangerZone />}

      <span>Vai trò: {effectiveRole}</span>
    </div>
  );
}
```

---

## 7. Component guard — wrapper pattern

Khi cần bọc cả section, tạo guard component:

```tsx
'use client';
import { usePermission } from '@/hooks/use-permission';
import type { EffectiveRole } from '@/lib/rbac';
import type { PermissionAction } from '@prisma/client';

type Props = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
} & (
  | { resource: string; action: PermissionAction | 'FULL'; groupId?: string; minRole?: never }
  | { minRole: EffectiveRole; resource?: never; action?: never; groupId?: never }
);

export function Can(props: Props) {
  const { can, atLeast } = usePermission();

  const allowed =
    'minRole' in props && props.minRole
      ? atLeast(props.minRole)
      : can(props.resource!, props.action!, { groupId: props.groupId });

  if (!allowed) return <>{props.fallback ?? null}</>;
  return <>{props.children}</>;
}

// Dùng:
<Can resource="post" action="CREATE">
  <Button>+ Tạo bài</Button>
</Can>

<Can minRole="MANAGER" fallback={<p>Yêu cầu Manager trở lên.</p>}>
  <AdminPanel />
</Can>
```

---

## 8. Server component — đọc session trực tiếp

```tsx
// app/(dashboard)/settings/page.tsx — server component
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { hasPermission, type SessionUser } from '@/lib/rbac';

export default async function SettingsPage() {
  const session = await auth();
  if (!session) redirect('/login');
  const user = session.user as SessionUser;

  if (!user.isSuperAdmin && !hasPermission(user, 'setting', 'READ')) {
    redirect('/forbidden');
  }

  // ... fetch + render
}
```

---

## 9. Map 5 effective roles ↔ schema 4 roles

Schema `MemberRole` chỉ có 4 giá trị: `ADMIN | MANAGER | STAFF | VIEWER`. Effective role tính ở [rbac.ts](../../apps/web/src/lib/rbac.ts):

```ts
SUPERADMIN  = isSuperAdmin = true  (ADMIN của group type SYSTEM)
GROUP_ADMIN = ADMIN của group non-SYSTEM
MANAGER     = MANAGER (schema role trực tiếp)
STAFF       = STAFF
VIEWER      = VIEWER
```

`getEffectiveRole(user)` → tính role cao nhất trong các group user có. Dùng cho middleware route-level check.

---

## 10. Precompute permissions tại login

File: [auth.ts](../../apps/web/src/auth.ts) trong `authorize()` callback:

```ts
// Load permissions theo role user đang có
const rolesInUse = Array.from(new Set(user.groupMembers.map((m) => m.role)));
const rp = await prisma.rolePermission.findMany({
  where: { roleId: { in: rolesInUse } },
  include: { permission: { select: { resource: true, action: true } } },
});

// Map role → array of 'resource:action'
const permsByRole = new Map<MemberRole, string[]>();
for (const row of rp) {
  const list = permsByRole.get(row.roleId) ?? [];
  list.push(`${row.permission.resource}:${row.permission.action}`);
  permsByRole.set(row.roleId, list);
}

// Per-group permissions (vì user có thể khác role ở mỗi group)
const permissions: Record<string, string[]> = {};
for (const m of user.groupMembers) {
  permissions[m.groupId] = permsByRole.get(m.role) ?? [];
}
```

Kết quả được embed vào JWT → middleware + client đọc nhanh, không cần DB.

**Hệ quả**: khi đổi permission/role của user đang login → phải sign out + sign in lại để lấy JWT mới. Muốn realtime → invalidate session (tricky, skip trong Phase 0).

---

## 11. Đường dây thêm permission mới cho resource

Khi thêm resource (ví dụ `webhook`):

1. Thêm resource vào array `RESOURCES` trong [seed.ts](../../packages/db/prisma/seed.ts):
```ts
const RESOURCES = [..., 'webhook'];
```

2. Thêm action mapping cho từng role trong `ROLE_MATRIX`:
```ts
MANAGER: [..., 'webhook:CREATE', 'webhook:READ', 'webhook:UPDATE'],
STAFF:   [..., 'webhook:READ'],
```

3. Chạy seed lại:
```bash
npm run seed -w @media-ops/db
```

4. Dùng trong code:
```ts
if (!hasPermission(user, 'webhook', 'CREATE', { groupId })) throw Forbidden;
```

5. Existing users cần login lại để JWT refresh với permission mới.

---

## 12. Debug permission issue

### Server
```ts
console.log('user.id:', user.id);
console.log('isSuperAdmin:', user.isSuperAdmin);
console.log('groups:', user.groups);
console.log('perms for group X:', user.permissions[groupId]);
console.log('check post:UPDATE:', hasPermission(user, 'post', 'UPDATE', { groupId }));
```

### DB query trực tiếp — verify seed đúng
```sql
SELECT rp."roleId", p.resource, p.action
FROM "RolePermission" rp
JOIN "Permission" p ON p.id = rp."permissionId"
WHERE rp."roleId" = 'MANAGER'
ORDER BY p.resource, p.action;
```

### Client console
```tsx
const { user, effectiveRole } = usePermission();
console.log({ user, effectiveRole });
```

---

## 13. Common mistakes — đừng làm

| ❌ Sai | ✅ Đúng |
|-------|--------|
| `if (user.role === 'ADMIN')` | `if (hasPermission(user, resource, action))` |
| Query không scope groupId | `{ groupId: { in: user.groups.map(g=>g.id) } }` |
| Check permission chỉ ở client | Server là nguồn bảo mật, client chỉ UX |
| Check `role.level` không qua getEffectiveRole | `meetsRole(user, 'MANAGER')` |
| Quên `user.isSuperAdmin` bypass | Luôn `isSuperAdmin \|\| check()` |
| Quên soft-delete filter | `deletedAt: null` mọi query nghiệp vụ |
