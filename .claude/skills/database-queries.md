# Database Queries — Prisma patterns

> Schema: [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma). Đọc trước khi query.

---

## 1. Prisma client — luôn dùng singleton

```ts
import { prisma } from '@/lib/prisma';   // ✅ đúng — singleton, không leak connection

// ❌ sai — tạo instance mới mỗi request trong dev → pool exhaustion
const prisma = new PrismaClient();
```

File: [apps/web/src/lib/prisma.ts](../../apps/web/src/lib/prisma.ts).

---

## 2. Soft delete — BẮT BUỘC filter `deletedAt: null`

Mọi model có `deletedAt` (User, Group, Channel, Post, MediaLibrary) cần filter:

```ts
// ✅ Đúng
const posts = await prisma.post.findMany({
  where: { deletedAt: null, channelId: ... },
});

// ❌ Sai — trả cả bản ghi đã xoá
const posts = await prisma.post.findMany({
  where: { channelId: ... },
});
```

Xoá = update `deletedAt`:

```ts
await prisma.post.update({
  where: { id },
  data: { deletedAt: new Date() },
});
```

Restore = set `deletedAt: null`.

---

## 3. Scope theo group (RBAC)

Mọi query nghiệp vụ (trừ SuperAdmin) phải scope qua group user thuộc về:

```ts
import { Prisma } from '@prisma/client';

const groupIds = user.groups.map((g) => g.id);

// Channels thuộc group của user
const channelWhere: Prisma.ChannelWhereInput = user.isSuperAdmin
  ? { deletedAt: null }
  : { deletedAt: null, groups: { some: { groupId: { in: groupIds } } } };

const channels = await prisma.channel.findMany({ where: channelWhere });

// Posts trong các channel đó
const channelIds = channels.map((c) => c.id);
const posts = await prisma.post.findMany({
  where: { deletedAt: null, channelId: { in: channelIds } },
});
```

---

## 4. Include vs select — cân nhắc kích thước payload

```ts
// ❌ include mọi quan hệ → payload phình to
const user = await prisma.user.findUnique({
  where: { id },
  include: { groupMembers: true, authoredPosts: true, assignedTasks: true, uploads: true },
});

// ✅ select đúng field cần
const user = await prisma.user.findUnique({
  where: { id },
  select: {
    id: true,
    email: true,
    name: true,
    avatar: true,
    groupMembers: {
      select: {
        role: true,
        group: { select: { id: true, name: true, type: true } },
      },
    },
  },
});
```

Pattern kết hợp relation có include nhỏ:

```ts
const post = await prisma.post.findFirst({
  where: { id: params.id, deletedAt: null },
  include: {
    channel: {
      include: { groups: { select: { groupId: true } } },
    },
    author: { select: { id: true, name: true, avatar: true } },
  },
});
```

---

## 5. Pagination — offset

```ts
const { page, pageSize } = parsePagination(new URL(req.url)); // helper có sẵn

const [items, total] = await Promise.all([
  prisma.group.findMany({
    where,
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { createdAt: 'desc' },
  }),
  prisma.group.count({ where }),
]);
```

**Luôn parallel** count + findMany qua `Promise.all`.

## 6. Pagination — cursor (cho feed lớn)

```ts
const items = await prisma.post.findMany({
  where,
  take: limit + 1, // lấy dư 1 để biết có nextCursor
  cursor: cursor ? { id: cursor } : undefined,
  skip: cursor ? 1 : 0, // skip cursor row
  orderBy: { createdAt: 'desc' },
});

const hasMore = items.length > limit;
const nextCursor = hasMore ? items[limit - 1].id : null;
return ok(items.slice(0, limit), { meta: { nextCursor } });
```

---

## 7. Filter phức tạp — build `where` dynamic

```ts
const where: Prisma.PostWhereInput = {
  deletedAt: null,
  channelId: { in: channelIds },
};

if (params.platforms.length) where.platform = { in: params.platforms };
if (params.statuses.length) where.status = { in: params.statuses };
if (params.authorIds.length) where.authorId = { in: params.authorIds };

// Date range
if (params.start && params.end) {
  where.OR = [
    { scheduledAt: { gte: params.start, lte: params.end } },
    { publishedAt: { gte: params.start, lte: params.end } },
  ];
}

// Full-text LIKE
if (params.query) {
  where.OR = [
    ...(where.OR ?? []),
    { title: { contains: params.query, mode: 'insensitive' } },
    { content: { contains: params.query, mode: 'insensitive' } },
  ];
}
```

---

## 8. Transactions — nhiều bảng liên quan

Dùng `$transaction` khi thao tác **phải atomic** (all-or-nothing).

### Array form (đơn giản, operations độc lập)

```ts
const posts = await prisma.$transaction(
  channels.map((c) =>
    prisma.post.create({
      data: { title, content, platform: c.platform, channelId: c.id, ... },
    }),
  ),
);
```

### Callback form (cần read-then-write trong cùng TX)

```ts
const result = await prisma.$transaction(async (tx) => {
  const member = await tx.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (!member) throw new Error('NOT_MEMBER');

  if (member.role === 'ADMIN') {
    const adminCount = await tx.groupMember.count({
      where: { groupId, role: 'ADMIN' },
    });
    if (adminCount <= 1) throw new Error('LAST_ADMIN');
  }

  return tx.groupMember.delete({
    where: { userId_groupId: { userId, groupId } },
  });
});
```

Throw trong callback → toàn bộ rollback.

---

## 9. Upsert — idempotent create/update

```ts
// Idempotent analytics snapshot (unique trên channelId+date)
await prisma.analytics.upsert({
  where: { channelId_date: { channelId, date: today } },
  create: { channelId, date: today, platform, views, ... },
  update: { views, subscribers, ..., fetchedAt: new Date() },
});
```

Quan trọng với cron job chạy lặp → không tạo bản ghi trùng.

---

## 10. `$queryRaw` — CHỈ khi thực sự cần

Ví dụ aggregate mà Prisma API không hỗ trợ:

```ts
import { Prisma } from '@prisma/client';

// ✅ Đúng — tham số hoá qua template tag
const rows = await prisma.$queryRaw<Array<{ date: Date; total: number }>>`
  SELECT date_trunc('day', "publishedAt") as date, COUNT(*)::int as total
  FROM "Post"
  WHERE "deletedAt" IS NULL AND "channelId" = ${channelId}
  GROUP BY 1 ORDER BY 1 DESC LIMIT 30
`;

// ❌ Sai — SQL injection nếu channelId từ user input
await prisma.$queryRawUnsafe(`... WHERE "channelId" = '${channelId}'`);
```

Nếu cần build query động: dùng `Prisma.sql`:

```ts
const conditions = [Prisma.sql`"deletedAt" IS NULL`];
if (status) conditions.push(Prisma.sql`"status" = ${status}`);

await prisma.$queryRaw`
  SELECT * FROM "Post"
  WHERE ${Prisma.join(conditions, ' AND ')}
`;
```

---

## 11. Parallel query — `Promise.all`

Dashboard/analytics endpoint phải query parallel:

```ts
const [
  analyticsToday,
  postsCount,
  pendingTasks,
  channels,
] = await Promise.all([
  prisma.analytics.findMany({ where: { channelId: { in: ids }, date: today } }),
  prisma.post.count({ where: { ... } }),
  prisma.task.count({ where: { ... } }),
  prisma.channel.findMany({ where: { ... } }),
]);
```

Ví dụ thực tế: [api/v1/dashboard/overview/route.ts](../../apps/web/src/app/api/v1/dashboard/overview/route.ts) — 9 queries parallel.

---

## 12. Chống N+1

```ts
// ❌ N+1 — mỗi post fetch channel riêng
const posts = await prisma.post.findMany({ where });
for (const p of posts) {
  const ch = await prisma.channel.findUnique({ where: { id: p.channelId } });
}

// ✅ include trong 1 query
const posts = await prisma.post.findMany({
  where,
  include: { channel: { select: { id: true, name: true } } },
});
```

---

## 13. Composite unique — findUnique với key ghép

Ví dụ `GroupMember` có `@@id([userId, groupId])`:

```ts
const member = await prisma.groupMember.findUnique({
  where: { userId_groupId: { userId, groupId } },
});
```

Prisma tự sinh key theo convention `{a}_{b}` sorted theo thứ tự trong `@@id`/`@@unique`.

---

## 14. Enum type — import từ `@prisma/client`

```ts
import { Prisma, type PostStatus, type Platform } from '@prisma/client';

const where: Prisma.PostWhereInput = {
  status: { in: ['DRAFT', 'SCHEDULED'] as PostStatus[] },
  platform: 'YOUTUBE' satisfies Platform,
};
```

Cast từ Zod string → Prisma enum khi update:

```ts
data: parsed.data as Prisma.PostUpdateInput
```

---

## 15. Query log trong dev

Trong [lib/prisma.ts](../../apps/web/src/lib/prisma.ts):

```ts
export const prisma = g.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});
```

Debug query chậm: thêm `'query'` vào log list tạm thời.

---

## 16. Khi nào cần raw SQL vs Prisma

| Nên dùng Prisma | Nên dùng `$queryRaw` |
|-----------------|----------------------|
| CRUD đơn giản | GROUP BY + aggregate phức tạp |
| Relations standard | Window functions, CTE |
| Filter theo field | PostgreSQL-specific (jsonb ops, full-text) |
| Transaction ngắn | Recursive queries |

Khi dùng raw — luôn specify return type generic và tham số hoá.
