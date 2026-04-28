// POST /api/v1/channels/:id/sync — trigger sync cho 1 channel.
// PHASE 0 STUB: set Redis key `sync:running:{id}` (TTL 3s) + update Channel.metadata.lastSyncedAt.
// PHASE 1: enqueue BullMQ job; worker (apps/api) consume + gọi YouTubeService/MetaService...
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';
import { getRedis } from '@/lib/redis';

export const POST = withAuth<{ id: string }>(
  async ({ user, params }) => {
    const channel = await prisma.channel.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { groups: { select: { groupId: true } } },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh', { status: 404 });
    }

    const groupIds = channel.groups.map((g) => g.groupId);
    const canSync =
      user.isSuperAdmin ||
      groupIds.some(
        (gid) =>
          hasPermission(user, 'channel', 'UPDATE', { groupId: gid }) ||
          hasPermission(user, 'channel', 'FULL', { groupId: gid }),
      );
    if (!canSync) {
      return fail('FORBIDDEN', 'Không có quyền sync kênh này', { status: 403 });
    }
    if (channel.status === 'INACTIVE' || !channel.accessToken) {
      return fail(
        'CHANNEL_INACTIVE',
        'Kênh đang INACTIVE (token expired/disconnected) — reconnect trước khi sync',
        { status: 409 },
      );
    }

    const startedAt = new Date().toISOString();
    const jobId = `sync-${channel.id}-${Date.now().toString(36)}`;

    // Mark "running" qua Redis với TTL 3s (Phase 1 worker sẽ DEL khi xong)
    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(
          `sync:running:${channel.id}`,
          JSON.stringify({ jobId, startedAt }),
          'EX',
          3,
        );
      } catch {
        /* Redis down → tiếp tục, chỉ update DB */
      }
    }

    // Update lastSyncedAt — Phase 1 worker sẽ override với data thật
    const meta = (channel.metadata as Record<string, unknown> | null) ?? {};
    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        metadata: {
          ...meta,
          lastSyncedAt: startedAt,
          lastSyncJobId: jobId,
        } as Prisma.InputJsonValue,
      },
    });

    return ok({
      jobId,
      channelId: channel.id,
      status: 'queued',
      startedAt,
      note:
        'Phase 0 stub — Phase 1 BullMQ worker sẽ chạy sync thật. Hiện tại chỉ ghi nhận thời gian.',
    });
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
