// Analytics cron — 4 lịch quét + recompute sync priority.
//
//   1. EVERY 6h            : sync ALL active channels, staggered (≤200/tick × 30s spacing)
//   2. DAILY 07:00 (Asia/Ho_Chi_Minh) : full daily report — gửi email summary cho MANAGER+
//   3. EVERY HOUR          : sync channels có Post.publishedAt trong 24h gần nhất (HIGH)
//   4. EVERY 15 MIN        : sync channels đang build monetization (cumulative watch hours < 4000)
//   5. EVERY HOUR (offset 5min) : recompute Channel.syncPriority
//
// Stagger giải thích: KHÔNG enqueue tất cả channels tại 1 thời điểm — dùng
// BullMQ `delay` tăng 30s cho từng channel để spread quota + rate-limit window.
//
// LƯU Ý #18: cron in-process @nestjs/schedule chạy trên mọi replica → multi-pod
// = N lần enqueue. BullMQ `idempotencyKey` (queue.service ngầm dùng jobId)
// dedup được — nhưng vẫn nên Phase 8 chuyển BullMQ repeatable + Redis lock.
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Platform, SyncPriority } from '@prisma/client';
import { subDays } from 'date-fns';

import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from './queue.service';
import { SyncPriorityService } from './sync-priority.service';
import { YouTubeQuotaService } from './youtube-quota.service';

const STAGGER_SPACING_MS = 30 * 1000; // 30s giữa các channel
const STAGGER_MAX_PER_TICK = 200;
const MONETIZATION_WATCH_HOURS_THRESHOLD = 4000;

@Injectable()
export class AnalyticsCronService {
  private readonly logger = new Logger(AnalyticsCronService.name);
  private locks = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly priority: SyncPriorityService,
    private readonly quota: YouTubeQuotaService,
  ) {}

  // ════════════════════════════════════════════════════════════════════
  // 1. Mỗi giờ: sync tất cả ACTIVE channels (V2 spec — read-only monitoring tool)
  // ════════════════════════════════════════════════════════════════════
  @Cron(CronExpression.EVERY_HOUR)
  async syncAllActiveChannels(): Promise<void> {
    if (!this.acquire('syncAll')) return;
    try {
      const channels = await this.prisma.channel.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true, platform: true, syncPriority: true },
        orderBy: [{ syncPriority: 'asc' }, { lastSyncedAt: 'asc' }],
        take: STAGGER_MAX_PER_TICK,
      });
      if (channels.length === 0) return;

      let enqueued = 0;
      for (let i = 0; i < channels.length; i++) {
        const c = channels[i];
        // Skip nếu YT quota đã pass 80% và priority không phải HIGH
        if (
          c.platform === Platform.YOUTUBE &&
          c.syncPriority !== SyncPriority.HIGH &&
          (await this.quota.isPausedForLowPriority())
        ) {
          continue;
        }
        await this.queue.enqueueAnalyticsSync(
          {
            channelId: c.id,
            platform: c.platform,
            date: null,
            syncType: 'daily',
          },
          { delay: i * STAGGER_SPACING_MS },
        );
        enqueued++;
      }
      this.logger.log(
        `[hourly-sync] Enqueued ${enqueued}/${channels.length} channels (staggered ${STAGGER_SPACING_MS}ms)`,
      );
    } finally {
      this.release('syncAll');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. Daily 07:00 Asia/Ho_Chi_Minh = 00:00 UTC: daily report + email
  // ════════════════════════════════════════════════════════════════════
  @Cron('0 0 * * *', { timeZone: 'UTC' })
  async dailyReportAndEmail(): Promise<void> {
    if (!this.acquire('dailyReport')) return;
    try {
      // Bước 1: full re-sync tất cả channels (ghi đè priority, chấp nhận tốn quota)
      const channels = await this.prisma.channel.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true, platform: true },
      });
      for (let i = 0; i < channels.length; i++) {
        await this.queue.enqueueAnalyticsSync(
          {
            channelId: channels[i].id,
            platform: channels[i].platform,
            date: null,
            syncType: 'daily',
          },
          { delay: i * STAGGER_SPACING_MS },
        );
      }
      this.logger.log(
        `[daily-07] Enqueued ${channels.length} channels for daily report`,
      );

      // Bước 2: enqueue notifications gửi summary cho MANAGER+ (admin của group)
      const recipients = await this.prisma.user.findMany({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          groupMembers: { some: { role: { in: ['ADMIN', 'MANAGER'] } } },
        },
        select: { id: true, name: true, email: true },
      });

      const yesterday = subDays(new Date(), 1);
      const summary = await this.buildDailySummary(yesterday);

      for (const user of recipients) {
        await this.queue.enqueueNotification({
          userId: user.id,
          type: 'daily-report',
          data: {
            date: yesterday.toISOString().slice(0, 10),
            summary,
            recipientName: user.name,
            recipientEmail: user.email,
          },
          channels: ['email', 'inApp'],
        });
      }
      this.logger.log(
        `[daily-07] Enqueued daily-report notifications cho ${recipients.length} MANAGER+`,
      );
    } finally {
      this.release('dailyReport');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. Mỗi giờ: YouTube channels có video published trong 24h
  // ════════════════════════════════════════════════════════════════════
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyYoutubeNewVideos(): Promise<void> {
    if (!this.acquire('hourlyYT')) return;
    try {
      // V2: Post entity removed — cannot detect channels with new videos via DB.
      // Skipping recent-video-priority sync; full hourly sync handles all channels.
      void subDays;
      void Platform;
      void STAGGER_SPACING_MS;
      this.logger.debug('[hourly-YT] Skipped — Post entity not available in V2');
    } finally {
      this.release('hourlyYT');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. Mỗi 15 phút: YouTube channels đang build monetization
  //    (cumulative watch hours < 4000h theo Analytics 12 tháng gần nhất)
  // ════════════════════════════════════════════════════════════════════
  @Cron('*/15 * * * *')
  async buildingMonetizationSync(): Promise<void> {
    if (!this.acquire('monetization15')) return;
    try {
      // Quota gate strict — sync này tốn quota nhưng theo dõi sát milestone
      if (await this.quota.isPausedForLowPriority()) {
        this.logger.debug('[15m-monet] YT quota paused — skip');
        return;
      }

      const oneYearAgo = subDays(new Date(), 365);
      // Group bằng raw aggregate vì Prisma groupBy + having sum mất phức tạp
      const totals = await this.prisma.analytics.groupBy({
        by: ['channelId'],
        where: {
          platform: Platform.YOUTUBE,
          date: { gte: oneYearAgo },
        },
        _sum: { watchTimeHours: true },
      });
      const eligible = totals.filter(
        (t) =>
          (t._sum.watchTimeHours ?? 0) < MONETIZATION_WATCH_HOURS_THRESHOLD,
      );
      if (eligible.length === 0) return;

      // Filter chỉ ACTIVE channel
      const channels = await this.prisma.channel.findMany({
        where: {
          id: { in: eligible.map((e) => e.channelId) },
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true, platform: true },
      });

      for (let i = 0; i < channels.length; i++) {
        await this.queue.enqueueAnalyticsSync(
          {
            channelId: channels[i].id,
            platform: channels[i].platform,
            date: null,
            syncType: 'realtime',
          },
          { delay: i * STAGGER_SPACING_MS },
        );
      }
      this.logger.log(
        `[15m-monet] Enqueued ${channels.length} YT channels building monetization`,
      );
    } finally {
      this.release('monetization15');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. Mỗi giờ (offset 5 phút): recompute syncPriority cho mọi channel
  // ════════════════════════════════════════════════════════════════════
  @Cron('5 * * * *')
  async recomputeSyncPriority(): Promise<void> {
    if (!this.acquire('recomputePriority')) return;
    try {
      await this.priority.recomputeAll();
    } finally {
      this.release('recomputePriority');
    }
  }

  // ────────── Locks (in-process) ──────────

  private acquire(key: string): boolean {
    if (this.locks.get(key)) {
      this.logger.debug(`Lock '${key}' đang chiếm — skip tick`);
      return false;
    }
    this.locks.set(key, true);
    return true;
  }

  private release(key: string): void {
    this.locks.delete(key);
  }

  // ────────── Daily summary builder ──────────

  private async buildDailySummary(date: Date): Promise<{
    totalChannels: number;
    totalViews: number;
    totalSubscribers: number;
    totalRevenue: number;
    perPlatform: Record<string, { views: number; subscribers: number }>;
  }> {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCHours(23, 59, 59, 999);

    const rows = await this.prisma.analytics.findMany({
      where: { date: { gte: start, lte: end } },
      select: {
        platform: true,
        views: true,
        subscribers: true,
        revenue: true,
      },
    });

    const perPlatform: Record<string, { views: number; subscribers: number }> = {};
    let totalViews = 0;
    let totalSubscribers = 0;
    let totalRevenue = 0;
    const channelSet = new Set<string>();

    for (const r of rows) {
      const key = r.platform;
      if (!perPlatform[key]) perPlatform[key] = { views: 0, subscribers: 0 };
      perPlatform[key].views += r.views;
      perPlatform[key].subscribers += r.subscribers;
      totalViews += r.views;
      totalSubscribers += r.subscribers;
      totalRevenue += r.revenue;
    }

    const channelsCount = await this.prisma.channel.count({
      where: { deletedAt: null, status: 'ACTIVE' },
    });
    channelSet.size; // suppress unused

    return {
      totalChannels: channelsCount,
      totalViews,
      totalSubscribers,
      totalRevenue,
      perPlatform,
    };
  }
}
