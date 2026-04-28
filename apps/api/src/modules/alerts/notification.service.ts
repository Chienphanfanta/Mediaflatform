// NotificationService — gửi alert tới user qua in-app (đã có Alert row) + email.
//
// Email transport:
//   - Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email)
//   - Env: RESEND_API_KEY + EMAIL_FROM (vd "Media Ops <alerts@mediaops.app>")
//   - Nếu RESEND_API_KEY chưa set → log warn, no-op (Phase 1 dev OK)
//
// Recipients: channel owner + tất cả ADMIN của các group có channel đó
// (GroupMember.role=ADMIN). MANAGER+ không nhận tự động — dùng route /reports
// daily để xem.
//
// In-app: Alert row đã được AlertEngine tạo. Frontend polling /api/v1/alerts
// (60s) sẽ nhận. Service này KHÔNG tạo Alert thêm — nhận Alert sẵn từ caller.
//
// LƯU Ý: KHÔNG throw nếu email fail — log + return failed list. Caller có thể
// retry bằng cách enqueue lại notification job.
import { Injectable, Logger } from '@nestjs/common';
import { Alert, AlertSeverity, AlertType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { PushNotificationService, severityToEventType } from './push-notification.service';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const EMAIL_TIMEOUT_MS = 10_000;

export type NotifyAlertResult = {
  alertId: string;
  recipients: number;
  emailsSent: number;
  emailsFailed: number;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushNotificationService,
  ) {}

  /**
   * Gửi notification cho 1 alert vừa tạo. Idempotent qua Alert.metadata.notifiedAt
   * — gọi lại không gửi email duplicate.
   */
  async notifyAlert(alertId: string): Promise<NotifyAlertResult> {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            platform: true,
            ownerId: true,
            owner: { select: { id: true, name: true, email: true } },
            groups: {
              select: {
                groupId: true,
                group: {
                  select: {
                    id: true,
                    name: true,
                    members: {
                      where: { role: 'ADMIN' },
                      select: {
                        userId: true,
                        user: {
                          select: { id: true, name: true, email: true, status: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!alert) {
      this.logger.warn(`notifyAlert: alert ${alertId} không tồn tại`);
      return { alertId, recipients: 0, emailsSent: 0, emailsFailed: 0 };
    }

    const meta = (alert.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.notifiedAt === 'string') {
      this.logger.debug(`Alert ${alertId} đã notified — skip`);
      return { alertId, recipients: 0, emailsSent: 0, emailsFailed: 0 };
    }

    // Build recipients: owner + group ADMINs (dedup by id, exclude SUSPENDED/INVITED)
    const recipientMap = new Map<
      string,
      { id: string; name: string; email: string }
    >();
    if (alert.channel.owner) {
      recipientMap.set(alert.channel.owner.id, alert.channel.owner);
    }
    for (const cg of alert.channel.groups) {
      for (const m of cg.group.members) {
        if (m.user.status === 'ACTIVE') {
          recipientMap.set(m.user.id, {
            id: m.user.id,
            name: m.user.name,
            email: m.user.email,
          });
        }
      }
    }

    const recipients = [...recipientMap.values()];
    if (recipients.length === 0) {
      this.logger.warn(`Alert ${alertId} không có recipients`);
      await this.markNotified(alertId, meta, { recipients: 0, emailsSent: 0 });
      return { alertId, recipients: 0, emailsSent: 0, emailsFailed: 0 };
    }

    let emailsSent = 0;
    let emailsFailed = 0;
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? 'Media Ops <alerts@mediaops.app>';

    if (!apiKey) {
      this.logger.warn(
        `RESEND_API_KEY chưa set — skip ${recipients.length} email cho alert ${alertId}`,
      );
    } else {
      const html = renderAlertEmail({
        channelName: alert.channel.name,
        channelId: alert.channel.id,
        platform: alert.channel.platform,
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        metadata: meta,
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
      });
      const subject = renderAlertSubject(alert);

      // Tuần tự, không Promise.all — Resend free tier rate limit 2/s
      for (const r of recipients) {
        const ok = await this.sendEmail(apiKey, {
          from,
          to: r.email,
          subject,
          html,
        });
        if (ok) emailsSent++;
        else emailsFailed++;
      }
    }

    // Web push parallel — chỉ trigger CRITICAL/HIGH severity (giảm noise)
    let pushSent = 0;
    if (
      alert.severity === AlertSeverity.CRITICAL ||
      alert.severity === AlertSeverity.HIGH
    ) {
      const pushPayload = {
        title: `${alert.channel.name}`,
        body: alert.message.slice(0, 240),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `alert-${alert.id}`,
        data: { url: `/alerts`, alertId: alert.id },
      };
      const eventType = pushEventTypeForAlert(alert.type, alert.severity);
      for (const r of recipients) {
        const result = await this.push.sendToUser(r.id, pushPayload, eventType);
        pushSent += result.sent;
      }
    }

    await this.markNotified(alertId, meta, {
      recipients: recipients.length,
      emailsSent,
      pushSent,
    });

    return {
      alertId,
      recipients: recipients.length,
      emailsSent,
      emailsFailed,
    };
  }

  // Helper được override để testable — public để consumer khác (worker) reuse
  // event-type mapping nếu cần.

  // ────────── Internal ──────────

  private async markNotified(
    alertId: string,
    prevMeta: Record<string, unknown>,
    info: { recipients: number; emailsSent: number; pushSent?: number },
  ): Promise<void> {
    await this.prisma.alert.update({
      where: { id: alertId },
      data: {
        metadata: {
          ...prevMeta,
          notifiedAt: new Date().toISOString(),
          notificationStats: info,
        },
      },
    });
  }

  private async sendEmail(
    apiKey: string,
    payload: { from: string; to: string; subject: string; html: string },
  ): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        this.logger.warn(
          `Resend HTTP ${res.status} cho ${payload.to}: ${txt.slice(0, 200)}`,
        );
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(
        `Resend fetch lỗi cho ${payload.to}: ${(e as Error).message}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ────────── Email templates ──────────

const SEVERITY_BADGE: Record<AlertSeverity, { color: string; label: string }> = {
  LOW: { color: '#6B7280', label: 'Thông tin' },
  MEDIUM: { color: '#F59E0B', label: 'Cảnh báo' },
  HIGH: { color: '#EF4444', label: 'Khẩn cấp' },
  CRITICAL: { color: '#7F1D1D', label: 'Nguy hiểm' },
};

const TYPE_LABEL: Record<AlertType, string> = {
  TOKEN_EXPIRING: 'Token sắp hết hạn',
  TOKEN_EXPIRED: 'Token đã hết hạn',
  POLICY_VIOLATION: 'Vi phạm chính sách',
  COPYRIGHT_STRIKE: 'Strike bản quyền',
  VIEW_DROP: 'View giảm bất thường',
  MONETIZATION_LOST: 'Mất monetization',
  MONETIZATION_AT_RISK: 'Nguy cơ mất monetization',
  API_ERROR: 'Lỗi API platform',
  RATE_LIMIT: 'Đụng quota / rate limit',
  CHANNEL_INACTIVE: 'Kênh không hoạt động',
  SCHEDULED_POST_FAILED: 'Bài đăng thất bại',
  DEADLINE_APPROACHING: 'Sắp đến hạn task',
  OTHER: 'Cảnh báo',
};

const TYPE_ACTION: Record<AlertType, string> = {
  TOKEN_EXPIRING: 'Vào trang Kênh và refresh token trước khi hết hạn.',
  TOKEN_EXPIRED: 'Kết nối lại kênh để khôi phục dịch vụ.',
  POLICY_VIOLATION: 'Kiểm tra email từ platform và xử lý vi phạm.',
  COPYRIGHT_STRIKE: 'Vào platform để xử lý strike (gỡ video / kháng nghị).',
  VIEW_DROP: 'Kiểm tra analytics chi tiết để tìm nguyên nhân.',
  MONETIZATION_LOST: 'Liên hệ platform support để tìm hiểu lý do.',
  MONETIZATION_AT_RISK: 'Đẩy mạnh sản xuất nội dung để đạt threshold.',
  API_ERROR: 'Báo dev team kiểm tra log.',
  RATE_LIMIT: 'Sync sẽ tự nối lại sau khi window reset.',
  CHANNEL_INACTIVE: 'Lên lịch nội dung mới hoặc archive kênh nếu không còn dùng.',
  SCHEDULED_POST_FAILED: 'Vào Calendar > Failed để retry hoặc edit lại bài.',
  DEADLINE_APPROACHING: 'Hoàn thành task hoặc giao lại cho người khác.',
  OTHER: 'Vào dashboard để xem chi tiết.',
};

function renderAlertSubject(alert: Pick<Alert, 'severity' | 'type' | 'message'>): string {
  const badge = SEVERITY_BADGE[alert.severity].label;
  const type = TYPE_LABEL[alert.type];
  return `[${badge}] ${type} — ${alert.message.slice(0, 80)}`;
}

function renderAlertEmail(input: {
  channelName: string;
  channelId: string;
  platform: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  metadata: Record<string, unknown>;
  appUrl: string;
}): string {
  const badge = SEVERITY_BADGE[input.severity];
  const typeLabel = TYPE_LABEL[input.type];
  const action = TYPE_ACTION[input.type];

  // Link sâu theo type → trang xử lý phù hợp
  const targetPath = (() => {
    switch (input.type) {
      case 'TOKEN_EXPIRING':
      case 'TOKEN_EXPIRED':
      case 'API_ERROR':
        return `/channels/${input.channelId}`;
      case 'SCHEDULED_POST_FAILED':
        return '/calendar/failed';
      case 'DEADLINE_APPROACHING':
        return '/dashboard';
      case 'VIEW_DROP':
      case 'MONETIZATION_AT_RISK':
      case 'MONETIZATION_LOST':
        return `/analytics/channels/${input.channelId}`;
      default:
        return '/alerts';
    }
  })();
  const actionUrl = `${input.appUrl.replace(/\/$/, '')}${targetPath}`;

  // Metadata bullet — chỉ render các key đơn giản
  const metaRows: string[] = [];
  for (const [k, v] of Object.entries(input.metadata)) {
    if (k === 'notifiedAt' || k === 'notificationStats') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      metaRows.push(`<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</li>`);
    }
  }

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(typeLabel)}</title>
</head>
<body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
    <tr>
      <td style="background:${badge.color};padding:16px 24px;color:#fff;font-weight:600;font-size:14px;letter-spacing:0.4px;text-transform:uppercase;">
        ${escapeHtml(badge.label)} · ${escapeHtml(typeLabel)}
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <h2 style="margin:0 0 8px;font-size:18px;">${escapeHtml(input.channelName)}</h2>
        <p style="margin:0 0 16px;color:#6B7280;font-size:13px;">${escapeHtml(input.platform)}</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">${escapeHtml(input.message)}</p>
        ${metaRows.length ? `<ul style="padding-left:20px;font-size:13px;color:#374151;line-height:1.6;">${metaRows.join('')}</ul>` : ''}
        <div style="margin-top:24px;padding:12px 16px;background:#FEF3C7;border-left:3px solid #F59E0B;font-size:13px;border-radius:4px;">
          <strong>Cần làm:</strong> ${escapeHtml(action)}
        </div>
        <div style="margin-top:24px;text-align:center;">
          <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:10px 24px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Mở trang xử lý</a>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 24px;background:#F9FAFB;color:#9CA3AF;font-size:11px;text-align:center;border-top:1px solid #E5E7EB;">
        Media Ops Platform · Tự động gửi từ alert engine. Không reply email này.
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function pushEventTypeForAlert(
  type: AlertType,
  severity: AlertSeverity,
): import('./push-notification.service').PushEventType {
  if (type === AlertType.SCHEDULED_POST_FAILED) return 'post-failed';
  if (type === AlertType.DEADLINE_APPROACHING) return 'task-deadline';
  return severityToEventType(severity);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
