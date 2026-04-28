// AlertEngineService — per-channel alert detection sau mỗi analytics sync.
//
// Khác với AlertsService.runDetection() (global, chạy theo cron):
//   - Engine scoped theo 1 channelId (rẻ hơn — chỉ check 1 kênh)
//   - Logic chi tiết hơn: 2 mức severity cho VIEW_DROP (MEDIUM/HIGH), 2 mức cho
//     CHANNEL_INACTIVE (LOW/MEDIUM), tracking monetizationProgress trong metadata
//   - Có escalation: nếu đã có alert chưa-đọc cùng type với severity thấp hơn,
//     UPGRADE severity thay vì tạo alert mới
//
// Gọi từ AnalyticsSyncWorker sau khi sync thành công 1 channel.
import { Injectable, Logger } from '@nestjs/common';
import {
  Alert,
  AlertSeverity,
  AlertType,
  Platform,
  Prisma,
} from '@prisma/client';
import { subDays, subMonths } from 'date-fns';

import { PrismaService } from '../../prisma/prisma.service';

const VIEW_DROP_MEDIUM = 0.7; // < 70% TB 7 ngày
const VIEW_DROP_HIGH = 0.4; // < 40% TB 7 ngày
const MONETIZATION_WATCH_HOURS_THRESHOLD = 4_000;
const MONETIZATION_WATCH_HIGH_THRESHOLD = 3_000;
const MONETIZATION_SUBS_THRESHOLD = 1_000;
const MONETIZATION_SUBS_MEDIUM_THRESHOLD = 800;
const MONETIZATION_AGE_LIMIT_MONTHS = 9;
const INACTIVE_LOW_DAYS = 7;
const INACTIVE_MEDIUM_DAYS = 14;
const TOKEN_EXPIRY_BUFFER_DAYS = 7;

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export type CheckConditionsResult = {
  channelId: string;
  alertsCreated: number;
  alertsEscalated: number;
  alertsSkipped: number;
  perType: Record<string, 'created' | 'escalated' | 'skipped' | 'no-data' | 'ok'>;
};

@Injectable()
export class AlertEngineService {
  private readonly logger = new Logger(AlertEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy 4 check (VIEW_DROP, MONETIZATION, CHANNEL_INACTIVE, TOKEN_EXPIRY).
   * Trả thống kê — caller (worker) có thể log / enqueue notifications.
   */
  async checkConditions(channelId: string): Promise<CheckConditionsResult> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        platform: true,
        status: true,
        tokenExpiresAt: true,
        accessToken: true,
        refreshToken: true,
        createdAt: true,
        metadata: true,
        deletedAt: true,
      },
    });
    if (!channel || channel.deletedAt) {
      return {
        channelId,
        alertsCreated: 0,
        alertsEscalated: 0,
        alertsSkipped: 0,
        perType: {},
      };
    }

    const out: CheckConditionsResult = {
      channelId,
      alertsCreated: 0,
      alertsEscalated: 0,
      alertsSkipped: 0,
      perType: {},
    };

    const apply = (type: string, r: 'created' | 'escalated' | 'skipped' | 'no-data' | 'ok') => {
      out.perType[type] = r;
      if (r === 'created') out.alertsCreated++;
      else if (r === 'escalated') out.alertsEscalated++;
      else if (r === 'skipped') out.alertsSkipped++;
    };

    apply('VIEW_DROP', await this.checkViewDrop(channel));
    if (channel.platform === Platform.YOUTUBE) {
      apply('MONETIZATION', await this.checkMonetization(channel));
    }
    apply('CHANNEL_INACTIVE', await this.checkChannelInactive(channel));
    apply('TOKEN_EXPIRY', await this.checkTokenExpiry(channel));

    return out;
  }

  // ════════════════════════════════════════════════════════════════════
  // VIEW_DROP
  // ════════════════════════════════════════════════════════════════════
  private async checkViewDrop(
    channel: ChannelLike,
  ): Promise<'created' | 'escalated' | 'skipped' | 'no-data' | 'ok'> {
    const today = startOfUTCDay(new Date());
    const weekAgo = subDays(today, 7);

    const [todayRow, weekRows] = await Promise.all([
      this.prisma.analytics.findUnique({
        where: { channelId_date: { channelId: channel.id, date: today } },
        select: { views: true },
      }),
      this.prisma.analytics.findMany({
        where: { channelId: channel.id, date: { gte: weekAgo, lt: today } },
        select: { views: true },
      }),
    ]);

    if (!todayRow || weekRows.length < 3) return 'no-data';
    const avg7 = weekRows.reduce((s, r) => s + r.views, 0) / weekRows.length;
    if (avg7 <= 0) return 'no-data';

    const ratio = todayRow.views / avg7;
    if (ratio >= VIEW_DROP_MEDIUM) return 'ok';

    const severity =
      ratio < VIEW_DROP_HIGH ? AlertSeverity.HIGH : AlertSeverity.MEDIUM;
    const dropPct = ((avg7 - todayRow.views) / avg7) * 100;

    return this.upsertAlert({
      channelId: channel.id,
      tenantId: channel.tenantId,
      type: AlertType.VIEW_DROP,
      severity,
      message: `${channel.name}: views giảm ${dropPct.toFixed(0)}% so với TB 7 ngày`,
      metadata: {
        todayViews: todayRow.views,
        avg7Days: Math.round(avg7),
        dropPercent: Math.round(dropPct),
        ratio: Number(ratio.toFixed(2)),
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // MONETIZATION (YouTube only)
  // ════════════════════════════════════════════════════════════════════
  private async checkMonetization(
    channel: ChannelLike,
  ): Promise<'created' | 'escalated' | 'skipped' | 'no-data' | 'ok'> {
    const meta = (channel.metadata ?? {}) as Record<string, unknown>;
    if (meta.monetizationEnabled === true) {
      // Đã monetize, vẫn cập nhật progress (= 100%)
      await this.updateMonetizationProgress(channel.id, meta, {
        watchHours: MONETIZATION_WATCH_HOURS_THRESHOLD,
        subscribers: MONETIZATION_SUBS_THRESHOLD,
        progressPercent: 100,
      });
      return 'ok';
    }

    const yearAgo = subDays(new Date(), 365);
    const [agg, latest] = await Promise.all([
      this.prisma.analytics.aggregate({
        where: { channelId: channel.id, date: { gte: yearAgo } },
        _sum: { watchTimeHours: true },
      }),
      this.prisma.analytics.findFirst({
        where: { channelId: channel.id },
        orderBy: { date: 'desc' },
        select: { subscribers: true },
      }),
    ]);

    const totalWatchHours = agg._sum.watchTimeHours ?? 0;
    const subs = latest?.subscribers ?? 0;
    const ageMonths = monthsBetween(channel.createdAt, new Date());

    // Update progress trong metadata mỗi check (không dedup)
    await this.updateMonetizationProgress(channel.id, meta, {
      watchHours: totalWatchHours,
      subscribers: subs,
      progressPercent: Math.min(
        100,
        Math.round(
          ((totalWatchHours / MONETIZATION_WATCH_HOURS_THRESHOLD +
            subs / MONETIZATION_SUBS_THRESHOLD) /
            2) *
            100,
        ),
      ),
    });

    // HIGH: watch < 3000h và channel < 9 tháng tuổi (chạy hết 12 tháng còn lại
    // ít, sắp out-of-window)
    const watchHigh =
      totalWatchHours < MONETIZATION_WATCH_HIGH_THRESHOLD &&
      ageMonths >= MONETIZATION_AGE_LIMIT_MONTHS;
    // MEDIUM: subs < 800 (còn cách 1000 nhiều)
    const subsMedium = subs < MONETIZATION_SUBS_MEDIUM_THRESHOLD;

    if (!watchHigh && !subsMedium) return 'ok';

    const severity = watchHigh ? AlertSeverity.HIGH : AlertSeverity.MEDIUM;
    const reasons: string[] = [];
    if (watchHigh)
      reasons.push(
        `watch ${totalWatchHours.toFixed(0)}h/4000h (${ageMonths.toFixed(1)} tháng tuổi)`,
      );
    if (subsMedium) reasons.push(`subs ${subs}/1000`);

    return this.upsertAlert({
      channelId: channel.id,
      tenantId: channel.tenantId,
      type: AlertType.MONETIZATION_AT_RISK,
      severity,
      message: `${channel.name}: nguy cơ không đạt monetization (${reasons.join(', ')})`,
      metadata: {
        watchHours: Math.round(totalWatchHours),
        subscribers: subs,
        ageMonths: Number(ageMonths.toFixed(1)),
        watchAtRiskHigh: watchHigh,
        subsAtRiskMedium: subsMedium,
      },
    });
  }

  private async updateMonetizationProgress(
    channelId: string,
    existingMeta: Record<string, unknown>,
    progress: { watchHours: number; subscribers: number; progressPercent: number },
  ): Promise<void> {
    await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        metadata: {
          ...existingMeta,
          monetizationProgress: {
            watchHours: Math.round(progress.watchHours),
            subscribers: progress.subscribers,
            progressPercent: progress.progressPercent,
            updatedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // CHANNEL_INACTIVE
  // ════════════════════════════════════════════════════════════════════
  private async checkChannelInactive(
    channel: ChannelLike,
  ): Promise<'created' | 'escalated' | 'skipped' | 'no-data' | 'ok'> {
    // V2 stripped: Post-based inactivity check. Sprint 6 sẽ thay bằng
    // ChannelMetric-based: views = 0 trong N ngày liên tiếp.
    const daysSinceCreated = daysBetween(channel.createdAt, new Date());
    if (daysSinceCreated < INACTIVE_LOW_DAYS) return 'ok';
    const severity =
      daysSinceCreated >= INACTIVE_MEDIUM_DAYS
        ? AlertSeverity.MEDIUM
        : AlertSeverity.LOW;
    return this.upsertAlert({
      channelId: channel.id,
      tenantId: channel.tenantId,
      type: AlertType.CHANNEL_INACTIVE,
      severity,
      message: `${channel.name}: theo dõi tần suất hoạt động (${Math.round(daysSinceCreated)} ngày kể từ khi tạo)`,
      metadata: { daysInactive: Math.round(daysSinceCreated) },
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // TOKEN_EXPIRY
  // ════════════════════════════════════════════════════════════════════
  private async checkTokenExpiry(
    channel: ChannelLike,
  ): Promise<'created' | 'escalated' | 'skipped' | 'no-data' | 'ok'> {
    if (!channel.tokenExpiresAt) return 'no-data';
    const ms = channel.tokenExpiresAt.getTime() - Date.now();
    const daysLeft = ms / (24 * 3600 * 1000);

    if (daysLeft > TOKEN_EXPIRY_BUFFER_DAYS) return 'ok';
    if (daysLeft <= 0) {
      // Đã expire — channel.status thường đã được mark TOKEN_EXPIRED bởi platform
      // service. Tạo alert TOKEN_EXPIRED severity HIGH.
      return this.upsertAlert({
        channelId: channel.id,
        tenantId: channel.tenantId,
        type: AlertType.TOKEN_EXPIRED,
        severity: AlertSeverity.HIGH,
        message: `${channel.name}: token đã hết hạn — cần kết nối lại`,
        metadata: {
          expiredAt: channel.tokenExpiresAt.toISOString(),
          hasRefreshToken: !!channel.refreshToken,
        },
      });
    }

    // < 7 ngày: HIGH alert + nếu có refreshToken thì caller (worker) tự refresh
    // qua next sync (withTokenRefresh pre-emptive). Engine chỉ tạo alert.
    return this.upsertAlert({
      channelId: channel.id,
      tenantId: channel.tenantId,
      type: AlertType.TOKEN_EXPIRING,
      severity: AlertSeverity.HIGH,
      message: `${channel.name}: token sắp hết hạn trong ${daysLeft.toFixed(1)} ngày`,
      metadata: {
        daysLeft: Number(daysLeft.toFixed(1)),
        expiresAt: channel.tokenExpiresAt.toISOString(),
        autoRefreshAvailable: !!channel.refreshToken,
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // upsertAlert — dedup + escalation
  // ════════════════════════════════════════════════════════════════════
  /**
   * Logic:
   *   1. Tìm alert chưa-đọc cùng (channelId, type) trong 24h
   *   2. Không có → tạo mới (return 'created')
   *   3. Có & severity hiện tại > severity cũ → escalate (return 'escalated')
   *   4. Có & severity hiện tại ≤ cũ → skip (return 'skipped')
   */
  private async upsertAlert(input: {
    channelId: string;
    tenantId: string;
    type: AlertType;
    severity: AlertSeverity;
    message: string;
    metadata: Record<string, unknown>;
  }): Promise<'created' | 'escalated' | 'skipped'> {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const existing = await this.prisma.alert.findFirst({
      where: {
        channelId: input.channelId,
        type: input.type,
        isRead: false,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, severity: true, metadata: true },
    });

    if (!existing) {
      await this.prisma.alert.create({
        data: {
          tenantId: input.tenantId,
          channelId: input.channelId,
          type: input.type,
          severity: input.severity,
          message: input.message,
          metadata: input.metadata as Prisma.InputJsonValue,
        },
      });
      return 'created';
    }

    if (SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity]) {
      // Escalate — update severity + message + metadata, giữ id để frontend không
      // bị "alert mới" duplicate (nhưng updatedAt move lên top trong UI sort).
      const prevMeta = (existing.metadata ?? {}) as Record<string, unknown>;
      await this.prisma.alert.update({
        where: { id: existing.id },
        data: {
          severity: input.severity,
          message: input.message,
          metadata: {
            ...prevMeta,
            ...input.metadata,
            escalated: true,
            previousSeverity: existing.severity,
            escalatedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      return 'escalated';
    }

    return 'skipped';
  }
}

// ────────── Internal types + helpers ──────────

type ChannelLike = {
  id: string;
  tenantId: string;
  name: string;
  platform: Platform;
  status: string;
  tokenExpiresAt: Date | null;
  accessToken: string | null;
  refreshToken: string | null;
  createdAt: Date;
  metadata: unknown;
  deletedAt: Date | null;
};

function startOfUTCDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (24 * 3600 * 1000);
}

function monthsBetween(a: Date, b: Date): number {
  const months =
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  // Day fraction để tránh lẫn lộn 9.0 vs 8.99
  const dayFrac = (b.getDate() - a.getDate()) / 30;
  return months + dayFrac;
}

// Suppress unused subMonths import (giữ cho readability — Phase 2 dùng cho tính ageMonths chính xác)
void subMonths;

// Re-export Alert để consumer dễ import 1 chỗ
export type { Alert };
