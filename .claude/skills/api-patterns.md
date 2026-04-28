# API Patterns — Media Ops Platform

> Đọc trước khi viết **bất kỳ** route handler nào trong `apps/web/src/app/api/v1/`.
> Chuẩn response và error codes tham chiếu **CLAUDE.md §8**.

---

## 1. Cấu trúc route handler chuẩn

Mọi route handler đi qua `withAuth()` — tự động check auth, rate limit, catch error và map thành response chuẩn.

```ts
// apps/web/src/app/api/v1/{resource}/route.ts
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';
import { fail, ok, noContent } from '@/lib/api-response';
import { mySchema } from '@/lib/schemas/my-resource';

// List + create
export const GET = withAuth(
  async ({ req, user }) => {
    // ... logic
    return ok(data, { meta: { pagination } });
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);

export const POST = withAuth(
  async ({ req, user }) => {
    const body = await req.json();
    const parsed = mySchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    // ... create
    return ok(created, { status: 201 });
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
```

Dynamic params (`[id]/route.ts`):

```ts
export const GET = withAuth<{ id: string }>(
  async ({ user, params }) => {
    const row = await prisma.post.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!row) return fail('POST_NOT_FOUND', '...', { status: 404 });
    return ok(row);
  },
);

export const DELETE = withAuth<{ id: string }>(
  async ({ user, params }) => {
    // ... check permission, soft delete
    return noContent(); // 204
  },
);
```

---

## 2. Response format (BẮT BUỘC)

Tất cả responses phải đi qua `ok()` / `fail()` / `noContent()` từ `@/lib/api-response`.

```ts
// Success
ok(data)                                                    // 200 + { success: true, data }
ok(data, { status: 201 })                                    // Created
ok(list, { meta: { pagination: {...} } })                   // With meta
noContent()                                                  // 204, không body

// Error
fail('CODE', 'Human message', { status: 422, details: {} }) // Any error
```

Shape:
```ts
type ApiResponse<T> =
  | { success: true; data: T; meta?: { pagination?: Pagination } }
  | { success: false; error: { code: string; message: string; details?: unknown } };
```

---

## 3. Zod validation

Schemas sống trong `apps/web/src/lib/schemas/{resource}.ts`. Shared giữa FE + BE.

```ts
// lib/schemas/group.ts
import { z } from 'zod';

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, 'Tên không được rỗng').max(100),
  type: z.enum(['HR', 'CONTENT', 'ANALYTICS', 'SYSTEM']),
  description: z.string().trim().max(500).optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
```

Validate ở route:
```ts
const parsed = createGroupSchema.safeParse(body);
if (!parsed.success) {
  return fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', {
    status: 422,
    details: parsed.error.issues,
  });
}
// Dùng parsed.data (đã type-safe)
```

**Không bao giờ** truyền body trực tiếp vào Prisma. Luôn qua Zod trước.

---

## 4. Permission check

```ts
import { hasPermission } from '@/lib/rbac';

// Scope theo groupId (lấy từ resource)
const canUpdate =
  user.isSuperAdmin ||
  hasPermission(user, 'post', 'UPDATE', { groupId: post.channel.groups[0].groupId }) ||
  hasPermission(user, 'post', 'FULL', { groupId: post.channel.groups[0].groupId });

if (!canUpdate) {
  return fail('FORBIDDEN', 'Không có quyền sửa bài này', { status: 403 });
}
```

Luôn kiểm tra `user.isSuperAdmin` trước → bypass.

Xem `.claude/skills/rbac-patterns.md` chi tiết.

---

## 5. Pagination

Dùng `parsePagination` từ schemas:

```ts
import { parsePagination } from '@/lib/schemas/group';

export const GET = withAuth(async ({ req }) => {
  const { page, pageSize } = parsePagination(new URL(req.url));

  const where = { deletedAt: null };
  const [items, total] = await Promise.all([
    prisma.group.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
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
});
```

Query: `?page=1&pageSize=20`. Max `pageSize=100`.

---

## 6. Error codes & status — reference

| Status | Code | Khi nào |
|--------|------|---------|
| 400 | `INVALID_JSON` | Body không parse được (withAuth tự handle) |
| 401 | `UNAUTHORIZED` | Chưa login (withAuth tự trả) |
| 403 | `FORBIDDEN` | Thiếu permission |
| 404 | `{RESOURCE}_NOT_FOUND` | `GROUP_NOT_FOUND`, `USER_NOT_FOUND`, `POST_NOT_FOUND`... |
| 409 | `ALREADY_{STATE}` / `LAST_{ROLE}` | Conflict nghiệp vụ: `ALREADY_MEMBER`, `LAST_ADMIN`, `DUPLICATE_EMAIL`... |
| 422 | `VALIDATION_FAILED` | Zod fail — kèm `details: issues` |
| 429 | `RATE_LIMITED` | withAuth tự trả — kèm `details: { retryAfter }` |
| 500 | `INTERNAL_ERROR` | Catch-all, withAuth log server-side |

Quy tắc:
- Code `SCREAMING_SNAKE_CASE`, ổn định để client switch-case.
- Message tiếng Anh (dev), FE map sang VN theo code.
- Không return 200 cho lỗi nghiệp vụ.

---

## 7. Rate limit

Per endpoint, mặc định key = `userId:pathname`:

```ts
export const POST = withAuth(
  handler,
  { rateLimit: { limit: 20, windowMs: 60_000 } }, // 20 req/phút/user
);
```

Guideline:
- Read-only GET: 60–120/phút
- Create/Update/Delete: 20–30/phút
- Write-heavy: 10/phút
- Webhook inbound: không qua withAuth, tự verify signature

Hiện là in-memory (chỉ đúng với 1 instance). Xem [rate-limit.ts](../../apps/web/src/lib/rate-limit.ts). Production → thay Redis.

---

## 8. URL & method convention

Resource số nhiều, kebab-case. Nested sâu 1 cấp.

```
GET    /api/v1/groups                          list
POST   /api/v1/groups                          create
GET    /api/v1/groups/:id                      detail
PATCH  /api/v1/groups/:id                      partial update
DELETE /api/v1/groups/:id                      soft delete → 204

POST   /api/v1/groups/:id/members              add (nested 1 cấp OK)
DELETE /api/v1/groups/:id/members/:userId      remove

POST   /api/v1/posts/:id/publish               domain action
```

Tránh: `/api/v1/groups/:id/channels/:cid/posts/:pid` — quá sâu. Dùng query string hoặc endpoint phẳng.

---

## 9. Scope theo group (BẮT BUỘC)

Mọi query nghiệp vụ (trừ SuperAdmin) phải scope. Pattern:

```ts
const groupIds = user.groups.map((g) => g.id);

const where: Prisma.ChannelWhereInput = user.isSuperAdmin
  ? { deletedAt: null }
  : { deletedAt: null, groups: { some: { groupId: { in: groupIds } } } };

const rows = await prisma.channel.findMany({ where });
```

Quên = lỗi bảo mật nghiêm trọng. Xem `.claude/skills/database-queries.md` và `.claude/skills/rbac-patterns.md`.

---

## 10. Endpoint tham khảo thực tế trong project

| Feature | File |
|---------|------|
| List + create với pagination | [api/v1/groups/route.ts](../../apps/web/src/app/api/v1/groups/route.ts) |
| Detail + update, chặn group SYSTEM | [api/v1/groups/[id]/route.ts](../../apps/web/src/app/api/v1/groups/[id]/route.ts) |
| Add/remove nested resource | [api/v1/groups/[id]/members/route.ts](../../apps/web/src/app/api/v1/groups/[id]/members/route.ts) |
| Bulk create qua transaction | [api/v1/posts/route.ts](../../apps/web/src/app/api/v1/posts/route.ts) |
| PATCH với permission check | [api/v1/posts/[id]/route.ts](../../apps/web/src/app/api/v1/posts/[id]/route.ts) |
| Parallel query + scope | [api/v1/dashboard/overview/route.ts](../../apps/web/src/app/api/v1/dashboard/overview/route.ts) |
| Query params phức tạp | [api/v1/calendar/route.ts](../../apps/web/src/app/api/v1/calendar/route.ts) |
