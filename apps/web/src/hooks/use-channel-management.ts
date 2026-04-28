'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { ChannelDetailV2 } from '@/lib/types/channel-management';

/**
 * Channel management detail (/api/v1/channels/:id).
 * Khác `useChannelDetail` (analytics endpoint) — focus management UI:
 * ownerships đầy đủ, metadata, lastSyncedAt/Error, 7 ngày metrics.
 */
export function useChannelManagement(channelId: string) {
  return useQuery<ChannelDetailV2, Error>({
    queryKey: ['channel', channelId],
    queryFn: () => apiFetch<ChannelDetailV2>(`/api/v1/channels/${channelId}`),
    staleTime: 120_000, // 2 phút (V2 spec)
    enabled: !!channelId,
  });
}
