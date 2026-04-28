'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { HRUserListItem } from '@/lib/types/hr';

type UsersResponse = { items: HRUserListItem[]; total: number };

export function useUsers(opts?: { groupId?: string }) {
  const params = new URLSearchParams();
  if (opts?.groupId) params.set('groupId', opts.groupId);
  const qs = params.toString();

  return useQuery<UsersResponse, Error>({
    queryKey: ['users', opts?.groupId ?? 'all'],
    queryFn: () =>
      apiFetch<UsersResponse>(`/api/v1/users${qs ? `?${qs}` : ''}`),
    staleTime: 120_000,
  });
}
