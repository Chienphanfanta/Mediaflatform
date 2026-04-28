'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { ChannelDetailResponse } from '@/lib/types/channel-detail';

export function useChannelDetail(channelId: string, period: '7d' | '30d' | '90d') {
  return useQuery<ChannelDetailResponse, Error>({
    queryKey: ['channel-detail', channelId, period],
    queryFn: () =>
      apiFetch<ChannelDetailResponse>(
        `/api/v1/analytics/channels/${channelId}/detail?period=${period}`,
      ),
    staleTime: 5 * 60_000,
    enabled: !!channelId,
  });
}
