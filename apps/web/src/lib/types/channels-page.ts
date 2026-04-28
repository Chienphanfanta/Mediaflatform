// Types cho /channels page — match shape /api/v1/channels?stats=1 và /sync-status.
import type { ChannelStatus, Platform } from '@prisma/client';

export type ChannelMonthStats = {
  views: number;
  watchTimeHours: number;
  subscriberDelta: number;
  engagementRate: number;
};

export type ChannelOwnershipBrief = {
  role: 'PRIMARY' | 'SECONDARY';
  employeeId: string;
  name: string;
  email: string;
  avatar: string | null;
};

export type ChannelListItemFull = {
  id: string;
  name: string;
  platform: Platform;
  status: ChannelStatus;
  accountId: string;
  externalUrl: string | null;
  description: string | null;
  category: string | null;
  tokenExpiresAt: string | null;
  groupIds: string[];
  groupNames: string[];
  metadata: Record<string, unknown> | null;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  ownerships: ChannelOwnershipBrief[];
  monthStats: ChannelMonthStats;
};

export type SyncInProgressItem = {
  channelId: string;
  channelName: string;
  platform: Platform;
  startedAt: string;
  jobId: string;
};

export type SyncRecentItem = {
  channelId: string;
  channelName: string;
  platform: Platform;
  lastSyncedAt: string;
};

export type SyncQuota = {
  total: number;
  used: number | null;
  remaining: number | null;
  resetAt: string;
  note?: string;
};

export type SyncStatusResponse = {
  inProgress: SyncInProgressItem[];
  recentSyncs: SyncRecentItem[];
  quotas: { YOUTUBE: SyncQuota };
  checkedAt: string;
};
