'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { DashboardOverview } from '@/lib/types/dashboard';

export function useDashboardOverview() {
  return useQuery<DashboardOverview, Error>({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => apiFetch<DashboardOverview>('/api/v1/dashboard/overview'),
    staleTime: 60_000, // 1 phút — dashboard không cần realtime
    refetchOnWindowFocus: true,
  });
}
