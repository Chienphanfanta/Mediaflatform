// AlertsService — CRUD + 6 detector. Mỗi detector trả số alert đã tạo.
// Idempotency: dùng `findRecentMatching()` để tránh tạo trùng alert cùng type+channelId trong N giờ.
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Alert,
  AlertSeverity,
  AlertType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type CreateAlertInput = {
  channelId: string;
  tenantId?: string; // optional — sẽ tự lookup từ channel nếu không truyền
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  metadata?: Prisma.InputJsonValue;
};

export type ListAlertsFilter = {
  channelIds: string[]; // scoped, [] = no access
  isRead?: boolean;
  severities?: AlertSeverity[];
  types?: AlertType[];
  page: number;
  pageSize: number;
};

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ────────── CRUD ──────────

  async list(filter: ListAlertsFilter) {
    if (filter.channelIds.length === 0) {
      return {
        items: [],
        unreadCount: 0,
        pagination: { page: 1, pageSize: filter.pageSize, total: 0, totalPages: 0 },
      };
    }

    const where: Prisma.AlertWhereInput = {
      channelId: { in: filter.channelIds },
    };
    if (filter.isRead !== undefined) where.isRead = filter.isRead;
    if (filter.severities?.length) where.severity = { in: filter.severities };
    if (filter.types?.length) where.type = { in: filter.types };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        include: {
          channel: { select: { id: true, name: true, platform: true } },
        },
      }),
      this.prisma.alert.count({ where }),
      this.prisma.alert.count({
        where: { channelId: { in: filter.channelIds }, isRead: false },
      }),
    ]);

    return {
      items,
      unreadCount,
      pagination: {
        page: filter.page,
        pageSize: filter.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / filter.pageSize)),
      },
    };
  }

  async markRead(id: string, allowedChannelIds: string[]): Promise<Alert> {
    const alert = await this.prisma.alert.findFirst({
      where: { id, channelId: { in: allowedChannelIds } },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.isRead) return alert;
    return this.prisma.alert.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(allowedChannelIds: string[]): Promise<{ count: number }> {
    if (allowedChannelIds.length === 0) return { count: 0 };
    const res = await this.prisma.alert.updateMany({
      where: { channelId: { in: allowedChannelIds }, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { count: res.count };
  }

  async delete(id: string, allowedChannelIds: string[]): Promise<void> {
    const alert = await this.prisma.alert.findFirst({
      where: { id, channelId: { in: allowedChannelIds } },
      select: { id: true },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    await this.prisma.alert.delete({ where: { id } });
  }

  async create(input: CreateAlertInput): Promise<Alert> {
    let tenantId = input.tenantId;
    if (!tenantId) {
      const ch = await this.prisma.channel.findUnique({
        where: { id: input.channelId },
        select: { tenantId: true },
      });
      if (!ch) throw new NotFoundException('Channel not found');
      tenantId = ch.tenantId;
    }
    return this.prisma.alert.create({
      data: {
        tenantId,
        channelId: input.channelId,
        type: input.type,
        severity: input.severity,
        message: input.message,
        metadata: input.metadata,
      },
    });
  }

  /**
   * Idempotent create — chỉ tạo nếu chưa có alert chưa-đọc cùng (type, channelId)
   * trong `dedupHours` giờ qua. Trả null nếu đã có (skip).
   */
  async createIfNoneRecent(
    input: CreateAlertInput,
    dedupHours = 24,
  ): Promise<Alert | null> {
    const since = new Date(Date.now() - dedupHours * 60 * 60 * 1000);
    const existing = await this.prisma.alert.findFirst({
      where: {
        channelId: input.channelId,
        type: input.type,
        isRead: false,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (existing) return null;
    return this.create(input);
  }

  // ────────── DETECTION ──────────

  /** Run tất cả detectors. Trả tổng alert đã tạo trong lần chạy này. */
  async runDetection(): Promise<{ created: number; perDetector: Record<string, number> }> {
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      this.detectViewDrop(),
      this.detectMonetizationAtRisk(),
    ]);
    const created = a + b;
    const perDetector = {
      VIEW_DROP: a,
      MONETIZATION_AT_RISK: b,
    };
    this.logger.log(
      `Detection done in ${Date.now() - t0}ms — created ${created} ${JSON.stringify(perDetector)}`,
    );
    return { created, perDetector };
  }

  /** VIEW_DROP — view hôm nay < 70% trung bình 7 ngày trước. */
  async detectViewDrop(): Promise<number> {
    const today = startOfDay(new Date());
    const yesterday = subDays(today, 1);
    const weekAgo = subDays(today, 7);

    const channels = await this.prisma.channel.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    if (channels.length === 0) return 0;

    let created = 0;
    for (const c of channels) {
      const [todayRow, weekRows] = await Promise.all([
        this.prisma.analytics.findUnique({
          where: { channelId_date: { channelId: c.id, date: today } },
          select: { views: true },
        }),
        this.prisma.analytics.findMany({
          where: { channelId: c.id, date: { gte: weekAgo, lt: today } },
          select: { views: true },
        }),
      ]);
      if (!todayRow || weekRows.length < 3) continue; // chưa đủ dữ liệu so sánh
      const avg7 = weekRows.reduce((s, r) => s + r.views, 0) / weekRows.length;
      if (avg7 <= 0) continue;
      if (todayRow.views >= avg7 * 0.7) continue;

      const dropPct = ((avg7 - todayRow.views) / avg7) * 100;
      const alert = await this.createIfNoneRecent(
        {
          channelId: c.id,
          type: AlertType.VIEW_DROP,
          severity: AlertSeverity.MEDIUM,
          message: `${c.name}: views giảm ${dropPct.toFixed(0)}% so với TB 7 ngày`,
          metadata: {
            todayViews: todayRow.views,
            avg7Days: Math.round(avg7),
            dropPercent: Math.round(dropPct),
          },
        },
        24,
      );
      if (alert) created++;
    }
    return created;
  }

  /**
   * MONETIZATION_AT_RISK — chỉ áp dụng YouTube. Cảnh báo khi:
   *   - subscribers < 800 (chưa đạt 1000), HOẶC
   *   - watch time ước tính 12 tháng < 3000h (ngưỡng 4000h, còn ~2 tháng để bù)
   */
  async detectMonetizationAtRisk(): Promise<number> {
    const channels = await this.prisma.channel.findMany({
      where: { deletedAt: null, platform: 'YOUTUBE', status: 'ACTIVE' },
      select: { id: true, name: true, metadata: true },
    });
    if (channels.length === 0) return 0;

    const today = startOfDay(new Date());
    const monthAgo = subDays(today, 30);
    let created = 0;

    for (const c of channels) {
      const meta = (c.metadata ?? {}) as Record<string, unknown>;
      if (meta.monetizationEnabled === true) continue; // đã monetize, bỏ qua

      const recent = await this.prisma.analytics.findMany({
        where: { channelId: c.id, date: { gte: monthAgo, lte: today } },
        orderBy: { date: 'desc' },
        select: { subscribers: true, watchTimeHours: true },
      });
      if (recent.length === 0) continue;

      const latestSubs = recent[0].subscribers;
      const monthlyWatch = recent.reduce((s, r) => s + r.watchTimeHours, 0);
      const yearlyEstimate = monthlyWatch * 12;

      const subsAtRisk = latestSubs < 800;
      const watchAtRisk = yearlyEstimate < 3000;
      if (!subsAtRisk && !watchAtRisk) continue;

      const reasons: string[] = [];
      if (subsAtRisk) reasons.push(`subs ${latestSubs}/1000`);
      if (watchAtRisk) reasons.push(`watch ${yearlyEstimate.toFixed(0)}h/4000h`);

      const alert = await this.createIfNoneRecent(
        {
          channelId: c.id,
          type: AlertType.MONETIZATION_AT_RISK,
          severity: AlertSeverity.HIGH,
          message: `${c.name}: nguy cơ không đạt monetization (${reasons.join(', ')})`,
          metadata: {
            subscribers: latestSubs,
            yearlyWatchEstimate: Math.round(yearlyEstimate),
            subsAtRisk,
            watchAtRisk,
          },
        },
        72, // dedup 3 ngày — không spam
      );
      if (alert) created++;
    }
    return created;
  }

  // V2 stripped: detectChannelInactive (Post-based), detectScheduledPostFailed (Post),
  // detectDeadlineApproaching (Task) — Sprint 6 sẽ thay bằng KPI-based detector.

  /**
   * COPYRIGHT_STRIKE — gọi từ webhook YouTube khi nhận signal strike.
   * Không chạy theo cron; expose để webhook handler invoke.
   */
  async createCopyrightStrike(
    channelId: string,
    payload: {
      videoId: string;
      videoTitle?: string;
      claimType?: 'COPYRIGHT' | 'CONTENT_ID' | 'OTHER';
      reason?: string;
    },
  ): Promise<Alert> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    return this.create({
      channelId,
      type: AlertType.COPYRIGHT_STRIKE,
      severity: AlertSeverity.CRITICAL,
      message: `${channel?.name ?? channelId}: copyright strike trên video ${payload.videoTitle ?? payload.videoId}`,
      metadata: payload,
    });
  }
}

// ────────── HELPERS (local, không export) ──────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 24 * 60 * 60 * 1000);
}
