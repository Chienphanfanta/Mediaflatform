// Web Push sender (server-side, dùng từ route handlers).
//
// Mirror đơn giản của apps/api/PushNotificationService — chỉ khác:
//   - apps/api: AlertEngine + post-publisher worker call notifyAlert (push qua server)
//   - apps/web: workflow.ts (submit/approve/reject) call sendToUserAfterAlert(alertId)
//     thay vì cross-app HTTP call.
//
// Cả 2 file dùng web-push trực tiếp + cùng VAPID env. DRY violation chấp nhận
// được (~80 dòng duplicate) thay vì build cross-app pipeline phức tạp.
import 'server-only';

import { AlertSeverity, AlertType } from '@prisma/client';
import webpush from 'web-push';

import { prisma } from '@/lib/prisma';

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@mediaops.app';
  if (!pub || !priv) return; // no-op nếu chưa config
  try {
    webpush.setVapidDetails(subject, pub, priv);
    vapidConfigured = true;
  } catch (e) {
    console.warn('[push-sender] VAPID setup failed:', (e as Error).message);
  }
}

type Payload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

type PushEventType =
  | 'alert-critical'
  | 'alert-high'
  | 'alert-medium'
  | 'post-failed'
  | 'task-deadline'
  | 'workflow-approved'
  | 'workflow-rejected'
  | 'workflow-submitted';

const SETTINGS_FOR_EVENT: Record<PushEventType, string> = {
  'alert-critical': 'alertCritical',
  'alert-high': 'alertHigh',
  'alert-medium': 'alertMedium',
  'post-failed': 'postFailed',
  'task-deadline': 'taskDeadline',
  'workflow-approved': 'workflowApproved',
  'workflow-rejected': 'workflowRejected',
  'workflow-submitted': 'workflowSubmitted',
};

/**
 * Gửi push cho 1 user qua tất cả devices.
 * Tôn trọng UserNotificationSettings — pushEnabled OFF hoặc event toggle OFF → skip.
 */
export async function sendPushToUser(
  userId: string,
  payload: Payload,
  eventType: PushEventType,
): Promise<{ sent: number; failed: number; removed: number }> {
  ensureVapid();
  if (!vapidConfigured) return { sent: 0, failed: 0, removed: 0 };

  const settings = await prisma.userNotificationSettings.findUnique({
    where: { userId },
  });
  // null → mặc định ON (xem schema defaults)
  if (settings) {
    if (!settings.pushEnabled) return { sent: 0, failed: 0, removed: 0 };
    const flag = SETTINGS_FOR_EVENT[eventType];
    if (flag in settings && (settings as Record<string, unknown>)[flag] === false) {
      return { sent: 0, failed: 0, removed: 0 };
    }
  }

  const devices = await prisma.userDevice.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (devices.length === 0) return { sent: 0, failed: 0, removed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    devices.map(async (d) => {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent++;
        await prisma.userDevice
          .update({ where: { id: d.id }, data: { lastSeenAt: new Date() } })
          .catch(() => undefined);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.userDevice
            .delete({ where: { id: d.id } })
            .catch(() => undefined);
          removed++;
        } else {
          failed++;
        }
      }
    }),
  );

  return { sent, failed, removed };
}

// ────────── Convenience wrappers cho workflow events ──────────

export type WorkflowEvent = 'submit' | 'approve' | 'reject';

/**
 * Gửi push sau workflow transition. Nhận target users (author cho approve/reject,
 * Manager+ cho submit) + post info. Caller quyết định ai nhận.
 */
export async function sendWorkflowPush(
  targetUserIds: string[],
  event: WorkflowEvent,
  postInfo: { id: string; title: string; channelName: string; reason?: string },
): Promise<void> {
  const eventType: PushEventType =
    event === 'approve'
      ? 'workflow-approved'
      : event === 'reject'
        ? 'workflow-rejected'
        : 'workflow-submitted';

  const payload: Payload = {
    title:
      event === 'approve'
        ? `Bài "${postInfo.title}" đã được duyệt`
        : event === 'reject'
          ? `Bài "${postInfo.title}" bị từ chối`
          : `Bài mới cần duyệt: ${postInfo.title}`,
    body:
      event === 'reject' && postInfo.reason
        ? `Lý do: ${postInfo.reason.slice(0, 200)}`
        : postInfo.channelName,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `workflow-${event}-${postInfo.id}`,
    data: {
      url: event === 'submit' ? '/review' : '/calendar',
      postId: postInfo.id,
      workflowEvent: event,
    },
  };

  await Promise.all(
    targetUserIds.map((uid) => sendPushToUser(uid, payload, eventType)),
  );
}

// Re-export AlertSeverity helper để symmetry với apps/api
export function severityToEventType(s: AlertSeverity): PushEventType {
  if (s === 'CRITICAL') return 'alert-critical';
  if (s === 'HIGH') return 'alert-high';
  return 'alert-medium';
}

// Suppress unused — keep AlertType import cho future expansion (vd type-specific routing)
void AlertType;
