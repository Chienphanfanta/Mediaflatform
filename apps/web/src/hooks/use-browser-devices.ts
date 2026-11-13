'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api-client';

export type BrowserDeviceItem = {
  id: string;
  name: string;
  browser: 'CHROME' | 'COCCOC' | 'OTHER';
  os: string | null;
  extensionVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  online: boolean;
  publishedCount: number;
  user: { id: string; name: string; email: string; avatar: string | null };
};

export function useBrowserDevices(mine = false) {
  return useQuery({
    queryKey: ['browser-devices', { mine }],
    queryFn: () =>
      apiFetch<{ items: BrowserDeviceItem[]; total: number }>('/api/v1/devices', {
        query: { mine: mine ? '1' : undefined },
      }),
    refetchInterval: 30_000,
  });
}

export function useCreatePairCode() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ code: string; expiresAt: string }>('/api/v1/devices/pair-code', {
        method: 'POST',
      }),
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/devices/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['browser-devices'] }),
  });
}
