// GET /api/v1/platforms/sync-status — snapshot trạng thái sync.
// FE polling 30s khi `inProgress.length > 0` (xem use-sync-status hook).
import type { Platform } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { ok } from '@/lib/api-response';
import { getRedis } from '@/lib/redis';

type InProgressItem = {
  channelId: string;
  channelName: string;
  platform: Platform;
  startedAt: string;
  jobId: string;
};

type RecentSyncItem = {
  channelId: string;
  channelName: string;
  platform: Platform;
  lastSyncedAt: string;
};

const YT_DAILY_QUOTA = 10_000;

export const GET = withAuth(
  async ({ user }) => {
    const groupIds = user.groups.map((g) => g.id);

    const channels = await prisma.channel.findMany({
      where: user.isSuperAdmin
        ? { deletedAt: null }
        : {
            deletedAt: null,
            groups: { some: { groupId: { in: groupIds } } },
          },
      select: {
        id: true,
        name: true,
        platform: true,
        metadata: true,
      },
    });

    const redis = getRedis();
    const inProgress: InProgressItem[] = [];
    const recent: RecentSyncItem[] = [];

    // Batch read Redis sync:running keys (nếu có Redis)
    if (redis && channels.length > 0) {
      try {
        const keys = channels.map((c) => `sync:running:${c.id}`);
        const values = await redis.mget(...keys);
        for (let i = 0; i < channels.length; i++) {
          const c = channels[i];
          const v = values[i];
          if (!v) continue;
          try {
            const parsed = JSON.parse(v) as { jobId: string; startedAt: string };
            inProgress.push({
              channelId: c.id,
              channelName: c.name,
              platform: c.platform,
              startedAt: parsed.startedAt,
              jobId: parsed.jobId,
            });
          } catch {
            /* ignore malformed */
          }
        }
      } catch {
        /* Redis down — không sao, recent vẫn từ DB */
      }
    }

    // Recent: tất cả channels có lastSyncedAt, sort desc
    for (const c of channels) {
      const meta = (c.metadata as Record<string, unknown> | null) ?? null;
      const lastSyncedAt = meta?.lastSyncedAt;
      if (typeof lastSyncedAt === 'string') {
        recent.push({
          channelId: c.id,
          channelName: c.name,
          platform: c.platform,
          lastSyncedAt,
        });
      }
    }
    recent.sort(
      (a, b) =>
        new Date(b.lastSyncedAt).getTime() - new Date(a.lastSyncedAt).getTime(),
    );

    // YouTube quota — đọc Redis counter (Phase 1 YouTubeService increment)
    const today = new Date().toISOString().slice(0, 10);
    let ytUsed: number | null = null;
    if (redis) {
      try {
        const v = await redis.get(`yt:quota:${today}`);
        ytUsed = v ? Number(v) : null;
      } catch {
        /* ignore */
      }
    }

    // Reset = 0:00 UTC ngày sau (theo Google docs PT, nhưng UTC đủ approximate)
    const tomorrow = new Date();
    tomorrow.setUTCHours(0, 0, 0, 0);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    return ok({
      inProgress,
      recentSyncs: recent.slice(0, 20),
      quotas: {
        YOUTUBE: {
          total: YT_DAILY_QUOTA,
          used: ytUsed,
          remaining: ytUsed === null ? null : Math.max(0, YT_DAILY_QUOTA - ytUsed),
          resetAt: tomorrow.toISOString(),
          note:
            ytUsed === null
              ? 'Quota tracking sẽ active khi Phase 1 wire YouTubeService'
              : undefined,
        },
      },
      checkedAt: new Date().toISOString(),
    });
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
