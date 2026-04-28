'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { ChannelListItemFull } from '@/lib/types/channels-page';

export function useChannels() {
  return useQuery<ChannelListItemFull[], Error>({
    queryKey: ['channels'],
    queryFn: () => apiFetch<ChannelListItemFull[]>('/api/v1/channels'),
    staleTime: 5 * 60_000,
  });
}
