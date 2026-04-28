'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { AlertItem, AlertsListResponse } from '@/lib/types/alerts';

export type AlertsFilter = {
  status: 'all' | 'unread' | 'read';
  severities: string[];
  types: string[];
  page: number;
  pageSize: number;
};

export const ALERTS_POLL_INTERVAL = 60_000; // 60 giây

export function useAlerts(filter: AlertsFilter) {
  const params = new URLSearchParams();
  params.set('status', filter.status);
  filter.severities.forEach((s) => params.append('severity', s));
  filter.types.forEach((t) => params.append('type', t));
  params.set('page', String(filter.page));
  params.set('pageSize', String(filter.pageSize));

  return useQuery<AlertsListResponse, Error>({
    queryKey: ['alerts', filter],
    queryFn: () => apiFetch<AlertsListResponse>(`/api/v1/alerts?${params}`),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Hook nhẹ chỉ để bell — chỉ unread, top 5, polling 60s. */
export function useUnreadAlerts() {
  return useQuery<AlertsListResponse, Error>({
    queryKey: ['alerts-unread-bell'],
    queryFn: () =>
      apiFetch<AlertsListResponse>('/api/v1/alerts?status=unread&page=1&pageSize=5'),
    refetchInterval: ALERTS_POLL_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

export function useMarkAlertRead() {
  const qc = useQueryClient();
  return useMutation<AlertItem, Error, string>({
    mutationFn: (id) => apiFetch<AlertItem>(`/api/v1/alerts/${id}/read`, { method: 'PUT' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-unread-bell'] });
    },
  });
}

export function useMarkAllAlertsRead() {
  const qc = useQueryClient();
  return useMutation<{ count: number }, Error, void>({
    mutationFn: () =>
      apiFetch<{ count: number }>('/api/v1/alerts/read-all', { method: 'PUT' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-unread-bell'] });
    },
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiFetch<void>(`/api/v1/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-unread-bell'] });
    },
  });
}
