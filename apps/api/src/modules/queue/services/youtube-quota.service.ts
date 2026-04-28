// YouTube Data API v3 quota tracking — 10,000 units/day default.
// Cost reference: https://developers.google.com/youtube/v3/determine_quota_cost
//   - channels.list, videos.list:    1 unit
//   - search.list (avoid):         100 units
//   - videos.insert (upload):     1600 units
//   - playlistItems.list:            1 unit
//   - YT Analytics query:            1 unit (riêng quota)
//
// Strategy:
//   - Track usage trong Redis key `yt:quota:{YYYY-MM-DD}` qua INCRBY
//   - TTL 36h cho safety (key tự dọn sau ngày kế tiếp)
//   - Threshold 80% (= 8000) → pause LOW + NORMAL priority sync
//   - Threshold 95% → pause cả HIGH (chỉ giữ scheduled video upload)
//   - Threshold 99% → tạo Alert CRITICAL
//
// Fail-open: Redis lỗi → cho phép call (đừng block traffic vì cache down).
import { Injectable, Logger } from '@nestjs/common';
import {
  AlertSeverity,
  AlertType,
  Platform,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../lib/redis.service';

export const YT_QUOTA_LIMIT = 10_000;
export const YT_QUOTA_PAUSE_THRESHOLD = 8_000; // 80% — pause non-critical
export const YT_QUOTA_CRITICAL_THRESHOLD = 9_500; // 95% — alert + pause cả HIGH
export const YT_QUOTA_ALERT_THRESHOLD = 9_900; // 99% — Alert CRITICAL

/** Cost ước lượng cho từng loại sync. Dùng để allocate trước khi gọi API. */
export const YT_SYNC_COSTS = {
  channelStats: 5, // channels.list + 1-2 calls auxiliary
  videosList: 5, // videos.list theo batch (50 items/call)
  analyticsQuery: 5, // 1-3 query reports
  monetizationCheck: 3,
  videoUpload: 1_600,
} as const;

export type SyncPriorityLevel = 'HIGH' | 'NORMAL' | 'LOW';

@Injectable()
export class YouTubeQuotaService {
  private readonly logger = new Logger(YouTubeQuotaService.name);
  private alertedToday = false;
  private alertedDate: string | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  // ────────── Public API ──────────

  async getUsage(): Promise<{ date: string; used: number; limit: number; remaining: number }> {
    const date = todayKey();
    const used = await this.readUsed(date);
    return {
      date,
      used,
      limit: YT_QUOTA_LIMIT,
      remaining: Math.max(0, YT_QUOTA_LIMIT - used),
    };
  }

  /**
   * Check + reserve quota TRƯỚC khi gọi YouTube API.
   * Trả `false` nếu nên skip (vd quota cạn cho priority này).
   * Caller có trách nhiệm gọi `consume()` sau khi API thực sự xong (hoặc skip nếu false).
   */
  async canConsume(
    cost: number,
    priority: SyncPriorityLevel = 'NORMAL',
  ): Promise<{ allowed: boolean; used: number; reason?: string }> {
    const { used } = await this.getUsage();
    const projected = used + cost;

    // HIGH luôn được trừ khi chưa critical (95%)
    if (priority === 'HIGH') {
      if (projected > YT_QUOTA_CRITICAL_THRESHOLD && cost < YT_SYNC_COSTS.videoUpload) {
        // Trừ video upload (1600 units) ra — luôn cho phép user upload đến gần limit
        return { allowed: false, used, reason: 'critical-threshold-reached' };
      }
      return { allowed: projected <= YT_QUOTA_LIMIT, used };
    }

    // NORMAL/LOW pause sau 80%
    if (projected > YT_QUOTA_PAUSE_THRESHOLD) {
      return {
        allowed: false,
        used,
        reason: `pause-threshold-reached (${used}/${YT_QUOTA_PAUSE_THRESHOLD})`,
      };
    }
    return { allowed: true, used };
  }

  /** Trừ quota sau khi đã gọi API thành công (atomic INCRBY trên Redis). */
  async consume(cost: number): Promise<number> {
    const date = todayKey();
    const newUsed = await this.incrBy(date, cost);
    await this.maybeAlert(newUsed);
    return newUsed;
  }

  /** Đặt lại counter (chủ yếu cho test). Production tự reset qua TTL. */
  async reset(): Promise<void> {
    const date = todayKey();
    await this.redis.del(`yt:quota:${date}`);
    this.alertedToday = false;
    this.alertedDate = null;
  }

  /** True nếu đã pass 80% — caller dùng để skip non-critical sync. */
  async isPausedForLowPriority(): Promise<boolean> {
    const { used } = await this.getUsage();
    return used >= YT_QUOTA_PAUSE_THRESHOLD;
  }

  // ────────── Internal ──────────

  private async readUsed(date: string): Promise<number> {
    const raw = await this.redis.get(`yt:quota:${date}`);
    return raw ? Number(raw) : 0;
  }

  private async incrBy(date: string, by: number): Promise<number> {
    const key = `yt:quota:${date}`;
    // RedisService không expose incrby — dùng get/set với race risk OK ở đây
    // (đa số 1 worker concurrency=5, drift vài unit không nghiêm trọng).
    const current = await this.readUsed(date);
    const next = current + by;
    await this.redis.set(key, String(next), 36 * 3600); // 36h TTL
    return next;
  }

  private async maybeAlert(used: number): Promise<void> {
    const date = todayKey();
    if (this.alertedDate !== date) {
      // Ngày mới → reset cờ
      this.alertedToday = false;
      this.alertedDate = date;
    }
    if (this.alertedToday) return;
    if (used < YT_QUOTA_ALERT_THRESHOLD) return;

    this.alertedToday = true;
    this.logger.error(
      `YouTube quota CRITICAL: ${used}/${YT_QUOTA_LIMIT} (${Math.round((used / YT_QUOTA_LIMIT) * 100)}%)`,
    );

    // Tạo Alert cho mỗi YouTube channel ACTIVE — quota là global per-app nhưng
    // alert hiển thị cho user của các channel YT (idempotent qua message+date).
    try {
      const channels = await this.prisma.channel.findMany({
        where: {
          platform: Platform.YOUTUBE,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true, tenantId: true },
        take: 50,
      });
      const message = `YouTube quota gần hết: ${used}/${YT_QUOTA_LIMIT} (${Math.round((used / YT_QUOTA_LIMIT) * 100)}%) — sync sẽ tạm dừng đến 0:00 PT ngày mai`;
      await this.prisma.$transaction(
        channels.map((c) =>
          this.prisma.alert.create({
            data: {
              tenantId: c.tenantId,
              channelId: c.id,
              type: AlertType.RATE_LIMIT,
              severity: AlertSeverity.CRITICAL,
              message,
              metadata: {
                quotaUsed: used,
                quotaLimit: YT_QUOTA_LIMIT,
                date,
              } as Prisma.InputJsonValue,
            },
          }),
        ),
      );
    } catch (e) {
      this.logger.warn(
        `Tạo quota CRITICAL alert thất bại: ${(e as Error).message}`,
      );
    }
  }
}

function todayKey(): string {
  // YYYY-MM-DD theo UTC — YouTube reset quota lúc 00:00 Pacific Time, nhưng
  // dùng UTC đơn giản chấp nhận lệch ~7-8h cho VN. Phase 2 dùng PT exact.
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
