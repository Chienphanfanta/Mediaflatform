'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

export type DepartmentBrief = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  managerId: string | null;
  manager: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  } | null;
  _count: { members: number };
  createdAt: string;
  updatedAt: string;
};

type ListResponse = { items: DepartmentBrief[]; total: number };

export function useDepartments() {
  return useQuery<ListResponse, Error>({
    queryKey: ['departments'],
    queryFn: () => apiFetch<ListResponse>('/api/v1/departments'),
    staleTime: 120_000,
  });
}

export function useDepartment(id: string) {
  return useQuery<DepartmentBrief, Error>({
    queryKey: ['department', id],
    queryFn: () => apiFetch<DepartmentBrief>(`/api/v1/departments/${id}`),
    staleTime: 120_000,
    enabled: !!id,
  });
}

export type CreateDepartmentPayload = {
  name: string;
  description?: string | null;
  color?: string | null;
  managerId?: string | null;
};

export type UpdateDepartmentPayload = Partial<CreateDepartmentPayload>;

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation<DepartmentBrief, Error, CreateDepartmentPayload>({
    mutationFn: (input) =>
      apiFetch<DepartmentBrief>('/api/v1/departments', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  });
}

export function useUpdateDepartment() {
  const qc = useQueryClient();
  return useMutation<
    DepartmentBrief,
    Error,
    { id: string; data: UpdateDepartmentPayload }
  >({
    mutationFn: ({ id, data }) =>
      apiFetch(`/api/v1/departments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['department', id] });
    },
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiFetch(`/api/v1/departments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  });
}
