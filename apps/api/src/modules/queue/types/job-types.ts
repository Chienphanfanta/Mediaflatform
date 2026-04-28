// Job payload TypeScript interfaces — V2 stripped (no post-publisher).
import type { Platform } from '@prisma/client';

// ────────── analytics-sync ──────────

export type AnalyticsSyncJob = {
  channelId: string;
  platform: Platform;
  /** YYYY-MM-DD — nếu null thì sync 'today' (theo timezone server). */
  date: string | null;
  syncType: 'daily' | 'realtime';
};

export type AnalyticsSyncResult = {
  channelId: string;
  rowsUpserted: number;
  daysFetched: number;
  skippedReason?: string;
};

// ────────── alert-checker ──────────

export type AlertCheckJob = {
  channelId: string;
  /** Detector key — match với method trong AlertsService. */
  checkType:
    | 'view-drop'
    | 'monetization-at-risk'
    | 'channel-inactive'
    | 'all';
};

export type AlertCheckResult = {
  channelId: string;
  alertsCreated: number;
};

// ────────── notification-sender ──────────

export type NotificationChannel = 'email' | 'inApp';

export type NotificationJob = {
  userId: string;
  type: string; // 'alert' | 'task-assigned' | 'post-published' | 'channel-error' | …
  data: Record<string, unknown>;
  channels: NotificationChannel[];
};

export type NotificationResult = {
  userId: string;
  delivered: NotificationChannel[];
  failed: Array<{ channel: NotificationChannel; error: string }>;
};
