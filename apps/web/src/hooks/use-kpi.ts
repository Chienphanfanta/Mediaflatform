'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type {
  BulkAssignKpiPayload,
  CreateKpiPayload,
  KpiListFilters,
  KpiListResponse,
  KpiRecalcResult,
  KpiSummaryChannel,
  KpiSummaryEmployee,
  KpiWithRelations,
  UpdateKpiPayload,
} from '@/lib/types/kpi';

// staleTime 2 phút — V2 spec; achievementPercent populate qua cron daily.
const KPI_STALE = 120_000;

function buildQuery(filters: KpiListFilters): string {
  const params = new URLSearchParams();
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  if (filters.channelId) params.set('channelId', filters.channelId);
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.periodType) params.set('periodType', filters.periodType);
  if (filters.status) params.set('status', filters.status);
  if (filters.activeOn) params.set('activeOn', filters.activeOn);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useKpis(filters: KpiListFilters = {}) {
  return useQuery<KpiListResponse, Error>({
    queryKey: ['kpis', filters],
    queryFn: () => apiFetch<KpiListResponse>(`/api/v1/kpi${buildQuery(filters)}`),
    staleTime: KPI_STALE,
  });
}

export function useKpi(id: string) {
  return useQuery<KpiWithRelations, Error>({
    queryKey: ['kpi', id],
    queryFn: () => apiFetch<KpiWithRelations>(`/api/v1/kpi/${id}`),
    staleTime: KPI_STALE,
    enabled: !!id,
  });
}

export function useKpiSummaryEmployee(employeeId: string, activeOn?: string) {
  const qs = activeOn ? `?activeOn=${activeOn}` : '';
  return useQuery<KpiSummaryEmployee, Error>({
    queryKey: ['kpi-summary-employee', employeeId, activeOn ?? 'now'],
    queryFn: () =>
      apiFetch<KpiSummaryEmployee>(
        `/api/v1/kpi/summary/employee/${employeeId}${qs}`,
      ),
    staleTime: KPI_STALE,
    enabled: !!employeeId,
  });
}

export function useKpiSummaryChannel(channelId: string, activeOn?: string) {
  const qs = activeOn ? `?activeOn=${activeOn}` : '';
  return useQuery<KpiSummaryChannel, Error>({
    queryKey: ['kpi-summary-channel', channelId, activeOn ?? 'now'],
    queryFn: () =>
      apiFetch<KpiSummaryChannel>(
        `/api/v1/kpi/summary/channel/${channelId}${qs}`,
      ),
    staleTime: KPI_STALE,
    enabled: !!channelId,
  });
}

export function useCreateKpi() {
  const qc = useQueryClient();
  return useMutation<KpiWithRelations, Error, CreateKpiPayload>({
    mutationFn: (input) =>
      apiFetch<KpiWithRelations>(`/api/v1/kpi`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kpis'] });
      qc.invalidateQueries({ queryKey: ['kpi-summary-employee'] });
      qc.invalidateQueries({ queryKey: ['kpi-summary-channel'] });
    },
  });
}

export function useUpdateKpi() {
  const qc = useQueryClient();
  return useMutation<
    KpiWithRelations,
    Error,
    { id: string; data: UpdateKpiPayload }
  >({
    mutationFn: ({ id, data }) =>
      apiFetch<KpiWithRelations>(`/api/v1/kpi/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['kpis'] });
      qc.invalidateQueries({ queryKey: ['kpi', id] });
      qc.invalidateQueries({ queryKey: ['kpi-summary-employee'] });
      qc.invalidateQueries({ queryKey: ['kpi-summary-channel'] });
    },
  });
}

export function useDeleteKpi() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiFetch<void>(`/api/v1/kpi/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kpis'] });
      qc.invalidateQueries({ queryKey: ['kpi-summary-employee'] });
      qc.invalidateQueries({ queryKey: ['kpi-summary-channel'] });
    },
  });
}

export function useRecalculateKpi() {
  const qc = useQueryClient();
  return useMutation<KpiRecalcResult, Error, string>({
    mutationFn: (id) =>
      apiFetch<KpiRecalcResult>(`/api/v1/kpi/${id}/recalculate`, {
        method: 'POST',
      }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['kpis'] });
      qc.invalidateQueries({ queryKey: ['kpi', id] });
      qc.invalidateQueries({ queryKey: ['kpi-summary-employee'] });
      qc.invalidateQueries({ queryKey: ['kpi-summary-channel'] });
    },
  });
}

export function useBulkAssignKpi() {
  const qc = useQueryClient();
  return useMutation<
    { count: number; items: Array<{ id: string; employeeId: string; status: string }> },
    Error,
    BulkAssignKpiPayload
  >({
    mutationFn: (input) =>
      apiFetch(`/api/v1/kpi/bulk`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kpis'] }),
  });
}
