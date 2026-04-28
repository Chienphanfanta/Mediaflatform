// analytics-sync worker — Phase 1.
//
// Flow:
//   1. Load Channel (status, platform, syncPriority)
//   2. Skip nếu TOKEN_EXPIRED, DISCONNECTED, ERROR, SUSPENDED
//   3. YouTube: check quota TRƯỚC khi call (reserve unit cost theo priority)
//   4. Dispatch theo platform → call sync method tương ứng
//   5. Update Channel.lastSyncedAt
//   6. Log SyncLog (success/skipped/failed)
//   7. Sau success: trigger alert detection (gọi AlertsService.runDetection lazy
//      — chỉ run nếu có channel sync hôm nay > 1 lần để tránh detection mỗi job)
//
// LƯU Ý: AlertsService.runDetection() global (xem #18) — không scope per-channel.
// Worker dùng debounce qua Redis SET NX EX 5min để chỉ run 1 lần dù 100 sync xong.
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Platform, Prisma, SyncStatus } from '@prisma/client';
import type { Job } from 'bullmq';

import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../lib/redis.service';
import { AlertEngineService } from '../../alerts/alert-engine.service';
import { AlertsService } from '../../alerts/alerts.service';
import { NotificationService } from '../../alerts/notification.service';
import { MetaService } from '../../platforms/meta.service';
import { TelegramService } from '../../platforms/telegram.service';
import { TwitterService } from '../../platforms/twitter.service';
import { YouTubeService } from '../../platforms/youtube.service';
import { JOB_TIMEOUT_MS, QUEUE_NAMES, WORKER_OPTIONS } from '../queues.constants';
import { JobLogService } from '../services/job-log.service';
import { SyncLogService } from '../services/sync-log.service';
import {
  YouTubeQuotaService,
  YT_SYNC_COSTS,
} from '../services/youtube-quota.service';
import type { AnalyticsSyncJob, AnalyticsSyncResult } from '../types/job-types';

const QUEUE = QUEUE_NAMES.ANALYTICS_SYNC;
const ALERT_DEBOUNCE_KEY = 'alerts:detection:debounce';
const ALERT_DEBOUNCE_SEC = 5 * 60;

@Processor(QUEUE, WORKER_OPTIONS[QUEUE])
export class AnalyticsSyncWorker extends WorkerHost {
  private readonly logger = new Logger(AnalyticsSyncWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobLog: JobLogService,
    private readonly syncLog: SyncLogService,
    private readonly redis: RedisService,
    private readonly alerts: AlertsService,
    private readonly alertEngine: AlertEngineService,
    private readonly notify: NotificationService,
    private readonly youtubeQuota: YouTubeQuotaService,
    private readonly youtube: YouTubeService,
    private readonly meta: MetaService,
    private readonly twitter: TwitterService,
    private readonly telegram: TelegramService,
  ) {
    super();
  }

  async process(job: Job<AnalyticsSyncJob>): Promise<AnalyticsSyncResult> {
    await this.jobLog.logActive(QUEUE, job);
    const t0 = Date.now();

    return runWithTimeout(JOB_TIMEOUT_MS[QUEUE], async () => {
      const { channelId, platform } = job.data;

      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: {
          id: true,
          status: true,
          platform: true,
          syncPriority: true,
        },
      });
      if (!channel) {
        await this.syncLog.log({
          channelId,
          platform,
          status: SyncStatus.FAILED,
          recordsUpdated: 0,
          durationMs: Date.now() - t0,
          jobId: String(job.id),
          errorMessage: 'Channel không tồn tại',
        });
        throw new Error(`Channel ${channelId} không tồn tại`);
      }
      if (channel.platform !== platform) {
        throw new Error(
          `Platform mismatch: channel=${channel.platform} job=${platform}`,
        );
      }

      // Skip cho channel có vấn đề
      const skipReason = unhealthySkipReason(channel.status);
      if (skipReason) {
        await this.markSkipped(
          channel.id,
          platform,
          job,
          skipReason,
          Date.now() - t0,
        );
        return {
          channelId,
          rowsUpserted: 0,
          daysFetched: 0,
          skippedReason: skipReason,
        };
      }

      // YouTube quota gate
      if (platform === Platform.YOUTUBE) {
        const cost = YT_SYNC_COSTS.channelStats + YT_SYNC_COSTS.analyticsQuery;
        const gate = await this.youtubeQuota.canConsume(
          cost,
          channel.syncPriority,
        );
        if (!gate.allowed) {
          await this.markSkipped(
            channel.id,
            platform,
            job,
            `quota-paused: ${gate.reason ?? 'unknown'}`,
            Date.now() - t0,
            { quotaUsed: gate.used },
          );
          return {
            channelId,
            rowsUpserted: 0,
            daysFetched: 0,
            skippedReason: 'quota-paused',
          };
        }
      }

      // Dispatch
      let result: { daysFetched: number; rowsUpserted: number; skippedReason?: string };
      try {
        result = await this.dispatch(channelId, platform);
      } catch (err) {
        const msg = (err as Error).message;
        await this.syncLog.log({
          channelId,
          platform,
          status: SyncStatus.FAILED,
          recordsUpdated: 0,
          durationMs: Date.now() - t0,
          jobId: String(job.id),
          errorMessage: msg,
        });
        throw err;
      }

      // Track YT quota usage sau khi sync xong
      if (platform === Platform.YOUTUBE && !result.skippedReason) {
        await this.youtubeQuota.consume(
          YT_SYNC_COSTS.channelStats + YT_SYNC_COSTS.analyticsQuery,
        );
      }

      // Update Channel.lastSyncedAt
      await this.prisma.channel.update({
        where: { id: channelId },
        data: { lastSyncedAt: new Date() },
      });

      // Run per-channel alert engine + notify recipients cho alerts mới/escalated
      try {
        const engineResult = await this.alertEngine.checkConditions(channelId);
        if (engineResult.alertsCreated > 0 || engineResult.alertsEscalated > 0) {
          await this.notifyRecentAlerts(channelId);
          this.logger.log(
            `Engine ${channelId}: created=${engineResult.alertsCreated} escalated=${engineResult.alertsEscalated} skipped=${engineResult.alertsSkipped}`,
          );
        }
      } catch (e) {
        // Engine fail không phá sync — log và tiếp tục
        this.logger.warn(
          `AlertEngine ${channelId} failed: ${(e as Error).message}`,
        );
      }

      // Log success
      await this.syncLog.log({
        channelId,
        platform,
        date: job.data.date ? new Date(job.data.date) : null,
        status: result.skippedReason ? SyncStatus.SKIPPED : SyncStatus.SUCCESS,
        recordsUpdated: result.rowsUpserted,
        durationMs: Date.now() - t0,
        jobId: String(job.id),
        metadata: {
          daysFetched: result.daysFetched,
          syncType: job.data.syncType,
          ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
        },
      });

      // Trigger alert detection (debounced)
      this.maybeRunAlertDetection().catch((e: Error) =>
        this.logger.warn(`alert detection trigger failed: ${e.message}`),
      );

      return {
        channelId,
        rowsUpserted: result.rowsUpserted,
        daysFetched: result.daysFetched,
        ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
      };
    });
  }

  private async dispatch(
    channelId: string,
    platform: Platform,
  ): Promise<{ daysFetched: number; rowsUpserted: number; skippedReason?: string }> {
    switch (platform) {
      case Platform.YOUTUBE: {
        const r = await this.youtube.syncChannelStats(channelId);
        return {
          daysFetched: r.daysFetched,
          rowsUpserted: r.rowsUpserted,
          skippedReason: r.skippedReason,
        };
      }
      case Platform.FACEBOOK: {
        const r = await this.meta.syncPageInsights(channelId);
        return {
          daysFetched: r.daysFetched,
          rowsUpserted: r.rowsUpserted,
          skippedReason: r.skippedReason,
        };
      }
      case Platform.INSTAGRAM: {
        const r = await this.meta.syncInstagramInsights(channelId);
        return {
          daysFetched: r.daysFetched,
          rowsUpserted: r.rowsUpserted,
          skippedReason: r.skippedReason,
        };
      }
      case Platform.X: {
        const r = await this.twitter.syncTweetMetrics(channelId);
        return {
          daysFetched: r.daysAggregated,
          rowsUpserted: r.rowsUpserted,
          skippedReason: r.skippedReason,
        };
      }
      case Platform.TELEGRAM: {
        // Telegram chỉ trả memberCount — đẩy vào Analytics row hôm nay
        const r = await this.telegram.syncChannelStats(channelId);
        const today = startOfUTCDay(new Date());
        await this.prisma.analytics.upsert({
          where: { channelId_date: { channelId, date: today } },
          create: {
            channelId,
            date: today,
            platform: Platform.TELEGRAM,
            subscribers: r.memberCount,
            raw: { memberCount: r.memberCount, chatTitle: r.chatTitle } as Prisma.InputJsonValue,
          },
          update: {
            subscribers: r.memberCount,
            raw: { memberCount: r.memberCount, chatTitle: r.chatTitle } as Prisma.InputJsonValue,
          },
        });
        return { daysFetched: 1, rowsUpserted: 1 };
      }
      case Platform.WHATSAPP:
        return {
          daysFetched: 0,
          rowsUpserted: 0,
          skippedReason: 'whatsapp-no-analytics',
        };
      default:
        throw new Error(`Platform ${platform} không support analytics sync`);
    }
  }

  private async markSkipped(
    channelId: string,
    platform: Platform,
    job: Job<AnalyticsSyncJob>,
    reason: string,
    durationMs: number,
    extraMeta?: Record<string, unknown>,
  ): Promise<void> {
    await this.syncLog.log({
      channelId,
      platform,
      date: job.data.date ? new Date(job.data.date) : null,
      status: SyncStatus.SKIPPED,
      recordsUpdated: 0,
      durationMs,
      jobId: String(job.id),
      metadata: { skippedReason: reason, syncType: job.data.syncType, ...extraMeta },
    });
  }

  /**
   * Sau khi engine tạo/escalate alert, notify recipients (owner + group ADMIN).
   * Lấy alert chưa notified trong 60s gần nhất cho channel — tránh spam alert
   * cũ không liên quan đến sync vừa xong.
   */
  private async notifyRecentAlerts(channelId: string): Promise<void> {
    const since = new Date(Date.now() - 60_000);
    const recent = await this.prisma.alert.findMany({
      where: {
        channelId,
        OR: [{ createdAt: { gte: since } }, { metadata: { path: ['escalatedAt'], gte: since.toISOString() } }],
      },
      select: { id: true, metadata: true },
      take: 10,
    });
    for (const a of recent) {
      const meta = (a.metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.notifiedAt === 'string') continue;
      try {
        await this.notify.notifyAlert(a.id);
      } catch (e) {
        this.logger.warn(
          `notifyAlert ${a.id} failed: ${(e as Error).message}`,
        );
      }
    }
  }

  private async maybeRunAlertDetection(): Promise<void> {
    const gate = await this.redis.checkRateLimit(
      ALERT_DEBOUNCE_KEY,
      ALERT_DEBOUNCE_SEC,
    );
    if (!gate.allowed) return;
    const result = await this.alerts.runDetection();
    this.logger.debug(
      `Alert detection (post-sync): created=${result.created}`,
    );
  }

  // ────────── BullMQ events ──────────

  @OnWorkerEvent('completed')
  async onCompleted(job: Job): Promise<void> {
    await this.jobLog.logCompleted(QUEUE, job, job.returnvalue);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<AnalyticsSyncJob>, err: Error): Promise<void> {
    this.logger.error(
      `Sync ${job.data.platform}/${job.data.channelId} failed: ${err.message}`,
    );
    await this.jobLog.logFailed(QUEUE, job, err);
  }

  @OnWorkerEvent('stalled')
  async onStalled(jobId: string): Promise<void> {
    await this.jobLog.logStalled(QUEUE, jobId);
  }
}

// ────────── Helpers ──────────

function unhealthySkipReason(status: string): string | null {
  if (status === 'INACTIVE') return 'channel-inactive';
  if (status === 'ARCHIVED') return 'channel-archived';
  return null;
}

function startOfUTCDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function runWithTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Job timeout sau ${ms}ms`)), ms),
    ),
  ]);
}
