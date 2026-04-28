'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { HRUserListItem } from '@/lib/types/hr';

type UsersResponse = { items: HRUserListItem[]; total: number };

export type UsersFilters = {
  groupId?: string;
  departmentId?: string;
  status?: string;
  role?: string;
  /** ?expand=full → kèm department + channels + kpiAvgAchievement */
  expand?: boolean;
};

export function useUsers(opts: UsersFilters = {}) {
  const params = new URLSearchParams();
  if (opts.groupId) params.set('groupId', opts.groupId);
  if (opts.departmentId) params.set('departmentId', opts.departmentId);
  if (opts.status) params.set('status', opts.status);
  if (opts.role) params.set('role', opts.role);
  if (opts.expand) params.set('expand', 'full');
  const qs = params.toString();

  return useQuery<UsersResponse, Error>({
    queryKey: ['users', opts],
    queryFn: () =>
      apiFetch<UsersResponse>(`/api/v1/users${qs ? `?${qs}` : ''}`),
    staleTime: 120_000,
  });
}

export type CreateUserPayload = {
  email: string;
  name: string;
  password: string;
  phone?: string | null;
  position?: string | null;
  avatar?: string | null;
  departmentId?: string | null;
  joinDate?: string | null;
  groupMemberships?: Array<{
    groupId: string;
    role: 'ADMIN' | 'MANAGER' | 'STAFF' | 'VIEWER';
  }>;
};

export type UpdateUserPayload = {
  name?: string;
  phone?: string | null;
  position?: string | null;
  avatar?: string | null;
  departmentId?: string | null;
  joinDate?: string | null;
};

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation<
    { id: string; email: string; name: string; status: string },
    Error,
    CreateUserPayload
  >({
    mutationFn: (input) =>
      apiFetch('/api/v1/users', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; data: UpdateUserPayload }>({
    mutationFn: ({ id, data }) =>
      apiFetch(`/api/v1/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['hr-user', id] });
    },
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) =>
      apiFetch(`/api/v1/users/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useTransferChannels() {
  const qc = useQueryClient();
  return useMutation<
    {
      fromUserId: string;
      toUserId: string;
      transferred: number;
      merged: number;
      demoted: number;
      totalProcessed: number;
    },
    Error,
    { id: string; toEmployeeId: string }
  >({
    mutationFn: ({ id, toEmployeeId }) =>
      apiFetch(`/api/v1/users/${id}/transfer-channels`, {
        method: 'POST',
        body: JSON.stringify({ toEmployeeId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['channels-list'] });
    },
  });
}
