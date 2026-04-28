'use client';

import { useQuery } from '@tanstack/react-query';
import type { Platform, SyncStatus } from '@prisma/client';
import { apiFetch } from '@/lib/api-client';

export type SyncLogItem = {
  id: string;
  platform: Platform;
  date: string | null;
  status: SyncStatus;
  recordsUpdated: number;
  durationMs: number;
  jobId: string | null;
  errorMessage: string | null;
  metadata: unknown;
  createdAt: string;
};

type Response = { items: SyncLogItem[]; total: number };

export function useChannelSyncLogs(channelId: string, limit = 20) {
  return useQuery<Response, Error>({
    queryKey: ['channel-sync-logs', channelId, limit],
    queryFn: () =>
      apiFetch<Response>(
        `/api/v1/channels/${channelId}/sync-logs?limit=${limit}`,
      ),
    staleTime: 60_000, // 1 phút (logs cập nhật nhanh hơn channels)
    enabled: !!channelId,
  });
}
