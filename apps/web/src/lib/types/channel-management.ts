// Types cho /api/v1/channels/:id GET — channel management detail.
// Khác `channel-detail.ts` (cho /analytics) — file này focus management view.
import type { ChannelStatus, OwnershipRole, Platform } from '@prisma/client';

export type ChannelOwnershipDetail = {
  role: OwnershipRole;
  employeeId: string;
  name: string;
  email: string;
  avatar: string | null;
  assignedAt: string;
};

export type ChannelRecentMetric = {
  date: string; // YYYY-MM-DD
  views: number;
  watchTimeHours: number;
  subscriberDelta: number;
  engagementRate: number;
  revenue: number;
};

export type ChannelDetailV2 = {
  id: string;
  name: string;
  platform: Platform;
  status: ChannelStatus;
  accountId: string;
  externalUrl: string | null;
  description: string | null;
  category: string | null;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  groups: Array<{ id: string; name: string }>;
  ownerships: ChannelOwnershipDetail[];
  recentMetrics: ChannelRecentMetric[];
};
