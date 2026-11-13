// Kiểu dữ liệu dùng chung giữa background, content runner và popup.
import type { ExtensionFlowsConfig, FlowPlatform, PlatformFlow } from '@media-ops/shared';

export type { ExtensionFlowsConfig, FlowPlatform, PlatformFlow };

export type QueueMedia = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  type: 'IMAGE' | 'VIDEO';
  url: string; // presigned GET (MinIO), hết hạn sau 1 giờ
};

export type QueueItem = {
  targetId: string;
  attempts: number;
  options: { privacy?: 'public' | 'private' | 'unlisted' | 'friends' } | null;
  platform: FlowPlatform;
  channel: {
    id: string;
    name: string;
    platform: FlowPlatform;
    accountId: string;
    externalUrl: string | null;
    metadata: Record<string, unknown> | null;
  };
  post: {
    id: string;
    title: string | null;
    caption: string;
    hashtags: string[];
    scheduledAt: string | null;
  };
  media: QueueMedia[];
};

export type MeInfo = {
  device: { id: string; name: string; browser: string };
  user: { id: string; name: string; email: string; avatar: string | null } | null;
  channels: Array<{
    id: string;
    name: string;
    platform: FlowPlatform;
    accountId: string;
    externalUrl: string | null;
  }>;
  pendingCount: number;
  serverTime: string;
};

/** Job đang chạy — lưu ở chrome.storage.session để sống sót khi service worker restart. */
export type CurrentJob = {
  targetId: string;
  channelName: string;
  platform: FlowPlatform;
  tabId: number;
  windowId?: number;
  startedAt: number;
  lastProgressAt: number;
  step: string;
  /** Runner đã giao bước "chờ URL" cho background (trang sẽ chuyển → runner bị huỷ) */
  awaitUrl?: {
    includes: string[];
    deadline: number;
    optional: boolean;
    extraDelayMs: number;
    externalUrl: string | null;
  };
};

export type JobLogEntry = {
  at: number;
  targetId: string;
  channelName: string;
  platform: FlowPlatform;
  ok: boolean;
  message: string;
  externalUrl?: string | null;
};

/** Dữ liệu gửi cho content runner. */
export type RunFlowJob = {
  targetId: string;
  flow: PlatformFlow;
  item: QueueItem;
};

export type FlowResult =
  | { ok: true; externalUrl: string | null }
  | { ok: false; error: string; retryable: boolean };

// ─── Messages ────────────────────────────────────────────────────────────────

export type RuntimeMessage =
  | { type: 'FLOW_PROGRESS'; targetId: string; step: string }
  | { type: 'FLOW_DONE'; targetId: string; result: FlowResult }
  | {
      type: 'FLOW_AWAIT_URL';
      targetId: string;
      includes: string[];
      timeoutMs: number;
      optional: boolean;
      /** Tổng thời gian các bước sleep sau waitUrl */
      extraDelayMs: number;
      externalUrl: string | null;
    }
  | { type: 'TICK_NOW' }
  | { type: 'GET_STATE' }
  | { type: 'UNPAIR' };

export type PopupState = {
  serverUrl: string | null;
  paired: boolean;
  paused: boolean;
  me: MeInfo | null;
  lastError: string | null;
  currentJob: CurrentJob | null;
  log: JobLogEntry[];
  version: string;
};
