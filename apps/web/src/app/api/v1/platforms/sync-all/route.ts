// POST /api/v1/platforms/sync-all — trigger sync cho mọi channel scope user có quyền.
// PHASE 0 STUB: tương tự /channels/:id/sync nhưng loop qua tất cả channels.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { ok } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';
import { getRedis } from '@/lib/redis';

export const POST = withAuth(
  async ({ user }) => {
    const userGroupIds = user.groups.map((g) => g.id);

    const channels = await prisma.channel.findMany({
      where: user.isSuperAdmin
        ? { deletedAt: null, accessToken: { not: null } }
        : {
            deletedAt: null,
            accessToken: { not: null },
            groups: { some: { groupId: { in: userGroupIds } } },
          },
      include: { groups: { select: { groupId: true } } },
    });

    // Filter theo permission từng channel
    const allowedChannels = channels.filter((c) => {
      if (user.isSuperAdmin) return true;
      const gIds = c.groups.map((g) => g.groupId);
      return gIds.some(
        (gid) =>
          hasPermission(user, 'channel', 'UPDATE', { groupId: gid }) ||
          hasPermission(user, 'channel', 'FULL', { groupId: gid }),
      );
    });

    const startedAt = new Date().toISOString();
    const redis = getRedis();
    const jobIds: string[] = [];

    for (const c of allowedChannels) {
      // Skip channels có token hết hạn
      if (c.status === 'TOKEN_EXPIRED') continue;

      const jobId = `sync-${c.id}-${Date.now().toString(36)}`;
      jobIds.push(jobId);

      if (redis) {
        try {
          await redis.set(
            `sync:running:${c.id}`,
            JSON.stringify({ jobId, startedAt }),
            'EX',
            3,
          );
        } catch {
          /* ignore */
        }
      }

      const meta = (c.metadata as Record<string, unknown> | null) ?? {};
      await prisma.channel.update({
        where: { id: c.id },
        data: {
          metadata: {
            ...meta,
            lastSyncedAt: startedAt,
            lastSyncJobId: jobId,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return ok({
      totalQueued: jobIds.length,
      skipped: allowedChannels.length - jobIds.length,
      jobIds,
      startedAt,
    });
  },
  { rateLimit: { limit: 5, windowMs: 60_000 } },
);
