// Web Push delivery — wrap web-push lib + lookup UserDevice/UserNotificationSettings.
//
// VAPID setup ở constructor — nếu thiếu key → log warn + tất cả call no-op
// (graceful degradation cho dev không set keys).
//
// Idempotency: caller (NotificationService) dùng `Alert.metadata.notifiedAt`
// flag — push gọi 1 lần per alert. Nhiều device của user → 1 push call/device.
//
// Auto-cleanup: HTTP 410 Gone từ push service = subscription invalid →
// xoá UserDevice row.
import { Injectable, Logger } from '@nestjs/common';
import { AlertSeverity } from '@prisma/client';
import * as webPush from 'web-push';

import { PrismaService } from '../../prisma/prisma.service';

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string; // group push notifications by tag (replace older with same tag)
  data?: {
    url?: string; // Click → mở URL này
    alertId?: string;
    [key: string]: unknown;
  };
};

/** Loại event để filter theo UserNotificationSettings. */
export type PushEventType =
  | 'alert-critical'
  | 'alert-high'
  | 'alert-medium'
  | 'post-failed'
  | 'task-deadline'
  | 'workflow-approved'
  | 'workflow-rejected'
  | 'workflow-submitted';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private vapidConfigured = false;

  constructor(private readonly prisma: PrismaService) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@mediaops.app';
    if (!pub || !priv) {
      this.logger.warn(
        'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY chưa set — Web Push DISABLED',
      );
      return;
    }
    try {
      webPush.setVapidDetails(subject, pub, priv);
      this.vapidConfigured = true;
    } catch (e) {
      this.logger.error(`VAPID setup failed: ${(e as Error).message}`);
    }
  }

  /** Public — gửi push cho 1 user qua tất cả devices. */
  async sendToUser(
    userId: string,
    payload: PushPayload,
    eventType: PushEventType,
  ): Promise<{ sent: number; failed: number; removed: number }> {
    if (!this.vapidConfigured) {
      return { sent: 0, failed: 0, removed: 0 };
    }
    if (!(await this.isEventEnabled(userId, eventType))) {
      return { sent: 0, failed: 0, removed: 0 };
    }
    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (devices.length === 0) return { sent: 0, failed: 0, removed: 0 };

    return this.sendToDevices(devices, payload);
  }

  /** Public — gửi push cho tất cả members của 1 group. */
  async sendToGroup(
    groupId: string,
    payload: PushPayload,
    eventType: PushEventType,
    opts?: { excludeUserId?: string },
  ): Promise<{ users: number; sent: number; failed: number }> {
    if (!this.vapidConfigured) {
      return { users: 0, sent: 0, failed: 0 };
    }
    const members = await this.prisma.groupMember.findMany({
      where: {
        groupId,
        userId: opts?.excludeUserId
          ? { not: opts.excludeUserId }
          : undefined,
      },
      select: { userId: true },
    });
    let sent = 0;
    let failed = 0;
    for (const m of members) {
      const r = await this.sendToUser(m.userId, payload, eventType);
      sent += r.sent;
      failed += r.failed;
    }
    return { users: members.length, sent, failed };
  }

  // ────────── Internal ──────────

  private async sendToDevices(
    devices: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
    payload: PushPayload,
  ): Promise<{ sent: number; failed: number; removed: number }> {
    let sent = 0;
    let failed = 0;
    let removed = 0;

    const body = JSON.stringify(payload);

    await Promise.all(
      devices.map(async (d) => {
        try {
          await webPush.sendNotification(
            { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
            body,
            { TTL: 60 * 60 * 24 }, // 24h: push service drop nếu user không nhận
          );
          sent++;
          // Update lastSeenAt để dashboard biết device active
          await this.prisma.userDevice
            .update({
              where: { id: d.id },
              data: { lastSeenAt: new Date() },
            })
            .catch(() => undefined);
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // Subscription expired/revoked — xoá row
            await this.prisma.userDevice
              .delete({ where: { id: d.id } })
              .catch(() => undefined);
            removed++;
          } else {
            failed++;
            this.logger.warn(
              `Push fail device=${d.id} status=${status}: ${(e as Error).message}`,
            );
          }
        }
      }),
    );

    return { sent, failed, removed };
  }

  private async isEventEnabled(
    userId: string,
    eventType: PushEventType,
  ): Promise<boolean> {
    const s = await this.prisma.userNotificationSettings.findUnique({
      where: { userId },
      select: settingsSelect(),
    });
    // Chưa setup settings → default tất cả ON (xem schema default).
    // Nhưng để chắc: nếu null → tạo mới với defaults rồi return true.
    if (!s) return true;
    if (!s.pushEnabled) return false;
    return resolveEventEnabled(s, eventType);
  }
}

function settingsSelect() {
  return {
    pushEnabled: true,
    alertCritical: true,
    alertHigh: true,
    alertMedium: true,
    postFailed: true,
    taskDeadline: true,
    workflowApproved: true,
    workflowRejected: true,
    workflowSubmitted: true,
  } as const;
}

type SettingsRow = Record<keyof ReturnType<typeof settingsSelect>, boolean>;

function resolveEventEnabled(s: SettingsRow, e: PushEventType): boolean {
  switch (e) {
    case 'alert-critical':
      return s.alertCritical;
    case 'alert-high':
      return s.alertHigh;
    case 'alert-medium':
      return s.alertMedium;
    case 'post-failed':
      return s.postFailed;
    case 'task-deadline':
      return s.taskDeadline;
    case 'workflow-approved':
      return s.workflowApproved;
    case 'workflow-rejected':
      return s.workflowRejected;
    case 'workflow-submitted':
      return s.workflowSubmitted;
  }
}

/** Map AlertSeverity → eventType cho integration với NotificationService. */
export function severityToEventType(s: AlertSeverity): PushEventType {
  switch (s) {
    case 'CRITICAL':
    case 'HIGH':
      return s === 'CRITICAL' ? 'alert-critical' : 'alert-high';
    case 'MEDIUM':
      return 'alert-medium';
    case 'LOW':
    default:
      return 'alert-medium'; // LOW không có event riêng — gắn vào medium toggle
  }
}
