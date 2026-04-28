'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { ChannelListItemFull } from '@/lib/types/channels-page';

export function useChannelsList() {
  return useQuery<ChannelListItemFull[], Error>({
    queryKey: ['channels-list', 'with-stats'],
    queryFn: () => apiFetch<ChannelListItemFull[]>('/api/v1/channels?stats=1'),
    staleTime: 120_000, // 2 phút (V2 spec)
  });
}

export function useSyncChannel() {
  const qc = useQueryClient();
  return useMutation<{ jobId: string; channelId: string }, Error, string>({
    mutationFn: (channelId) =>
      apiFetch<{ jobId: string; channelId: string }>(
        `/api/v1/channels/${channelId}/sync`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels-list'] });
      qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });
}

export function useSyncAllChannels() {
  const qc = useQueryClient();
  return useMutation<{ totalQueued: number; jobIds: string[] }, Error, void>({
    mutationFn: () =>
      apiFetch<{ totalQueued: number; jobIds: string[] }>(
        '/api/v1/platforms/sync-all',
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels-list'] });
      qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (channelId) =>
      apiFetch<void>(`/api/v1/channels/${channelId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels-list'] }),
  });
}

export type CreateChannelPayload = {
  name: string;
  platform: string;
  accountId: string;
  externalUrl?: string | null;
  description?: string | null;
  category?: string | null;
  groupIds?: string[];
  primaryOwnerId?: string;
};

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation<
    { id: string; name: string; platform: string; status: string },
    Error,
    CreateChannelPayload
  >({
    mutationFn: (input) =>
      apiFetch(`/api/v1/channels`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels-list'] }),
  });
}

export function useArchiveChannel() {
  const qc = useQueryClient();
  return useMutation<{ id: string; status: string }, Error, string>({
    mutationFn: (channelId) =>
      apiFetch<{ id: string; status: string }>(
        `/api/v1/channels/${channelId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ status: 'ARCHIVED' }),
        },
      ),
    onSuccess: (_data, channelId) => {
      qc.invalidateQueries({ queryKey: ['channels-list'] });
      qc.invalidateQueries({ queryKey: ['channel', channelId] });
    },
  });
}

export function useDisconnectChannel() {
  const qc = useQueryClient();
  return useMutation<
    { disconnectedAt: string; channelId: string },
    Error,
    { platform: string; channelId: string }
  >({
    mutationFn: ({ platform, channelId }) =>
      apiFetch(
        `/api/v1/platforms/${platform.toLowerCase()}/disconnect/${channelId}`,
        { method: 'POST' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels-list'] }),
  });
}
