// GET /api/v1/devices — danh sách trình duyệt đã ghép extension.
//   STAFF: chỉ của mình · MANAGER+: toàn tenant (?mine=1 để lọc của mình)
import type { Prisma } from '@prisma/client';

import { ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';

/** Trình duyệt được coi là online nếu heartbeat trong 3 phút gần nhất. */
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export const GET = withAuth(async ({ req, user }) => {
  const url = new URL(req.url);
  const mineOnly = url.searchParams.get('mine') === '1' || !meetsRole(user, 'MANAGER');
  const where: Prisma.BrowserDeviceWhereInput = mineOnly ? { userId: user.id } : {};

  const rows = await prisma.browserDevice.findMany({
    where,
    orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { lastSeenAt: 'desc' }],
    select: {
      id: true,
      name: true,
      browser: true,
      os: true,
      extensionVersion: true,
      lastSeenAt: true,
      revokedAt: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, avatar: true } },
      _count: { select: { targets: { where: { status: 'PUBLISHED' } } } },
    },
  });

  const now = Date.now();
  const items = rows.map(({ _count, ...d }) => ({
    ...d,
    publishedCount: _count.targets,
    online: !d.revokedAt && !!d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
  }));
  return ok({ items, total: items.length });
});
