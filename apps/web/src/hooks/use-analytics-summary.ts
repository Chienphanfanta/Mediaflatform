'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { AnalyticsSummaryResponse } from '@/lib/types/analytics-summary';

export type AnalyticsPeriodState =
  | { mode: 'preset'; period: '7d' | '30d' | '90d' }
  | { mode: 'custom'; from: string; to: string }; // YYYY-MM-DD

export function useAnalyticsSummary(state: AnalyticsPeriodState, groupId?: string) {
  const params = new URLSearchParams();
  if (state.mode === 'preset') {
    params.set('period', state.period);
  } else {
    params.set('from', new Date(state.from).toISOString());
    params.set('to', new Date(state.to).toISOString());
  }
  if (groupId) params.set('groupId', groupId);

  const enabled =
    state.mode === 'preset' || (!!state.from && !!state.to && state.to >= state.from);

  return useQuery<AnalyticsSummaryResponse, Error>({
    queryKey: ['analytics-summary', state, groupId ?? null],
    queryFn: () => apiFetch<AnalyticsSummaryResponse>(`/api/v1/analytics/summary?${params}`),
    staleTime: 5 * 60_000, // 5 phút
    enabled,
  });
}
