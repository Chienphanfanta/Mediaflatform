'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { SyncStatusResponse } from '@/lib/types/channels-page';

const POLL_MS = 30_000;

/**
 * Polling 30s khi có ít nhất 1 channel đang sync. Khi không có, dừng polling
 * (refetchInterval=false) — vẫn fetch khi user mở/quay lại page.
 */
export function useSyncStatus() {
  return useQuery<SyncStatusResponse, Error>({
    queryKey: ['sync-status'],
    queryFn: () => apiFetch<SyncStatusResponse>('/api/v1/platforms/sync-status'),
    staleTime: 10_000,
    refetchInterval: (query) => {
      const data = query.state.data as SyncStatusResponse | undefined;
      return data && data.inProgress.length > 0 ? POLL_MS : false;
    },
    refetchIntervalInBackground: false,
  });
}
