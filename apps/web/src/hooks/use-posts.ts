'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Platform, PostStatus, PostTargetStatus } from '@prisma/client';

import { apiFetch } from '@/lib/api-client';

// ─── Types (khớp response của /api/v1/posts) ─────────────────────────────────

export type PostMediaItem = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  type: 'IMAGE' | 'VIDEO';
  order: number;
  previewUrl?: string;
};

export type PostTargetItem = {
  id: string;
  status: PostTargetStatus;
  externalUrl: string | null;
  errorMessage: string | null;
  attempts: number;
  publishedAt: string | null;
  claimedAt: string | null;
  channel: { id: string; name: string; platform: Platform; externalUrl: string | null };
  device: { id: string; name: string; browser: string } | null;
};

export type PostItem = {
  id: string;
  title: string | null;
  caption: string;
  hashtags: string[];
  scheduledAt: string | null;
  status: PostStatus;
  createdAt: string;
  createdBy: { id: string; name: string; avatar: string | null };
  media: PostMediaItem[];
  targets: PostTargetItem[];
};

export type PostableChannel = {
  id: string;
  name: string;
  platform: Platform;
  status: string;
  hasBrowser: boolean;
  browserOnline: boolean;
  owners: Array<{
    id: string;
    name: string;
    role: 'PRIMARY' | 'SECONDARY';
    browsers: number;
    browserOnline: boolean;
    canBeReminded: boolean;
  }>;
};

export type PostPayload = {
  title?: string | null;
  caption: string;
  hashtags: string[];
  scheduledAt?: string | null;
  mediaIds: string[];
  channelIds: string[];
  options?: { privacy?: 'public' | 'private' | 'unlisted' | 'friends'; madeForKids?: boolean };
  draft?: boolean;
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export function usePosts(filter: { status?: PostStatus; mine?: boolean; page?: number }) {
  return useQuery({
    queryKey: ['posts', filter],
    queryFn: () =>
      apiFetch<{
        items: PostItem[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>('/api/v1/posts', {
        query: {
          status: filter.status,
          mine: filter.mine ? 'true' : undefined,
          page: filter.page ?? 1,
          pageSize: 20,
        },
      }),
    // Tự làm mới khi còn bài đang chờ/đang đăng
    refetchInterval: (q) =>
      q.state.data?.items.some((p) => p.status === 'SCHEDULED' || p.status === 'PUBLISHING')
        ? 15_000
        : false,
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: ['posts', 'detail', id],
    queryFn: () => apiFetch<PostItem>(`/api/v1/posts/${id}`),
    refetchInterval: (q) =>
      q.state.data?.status === 'SCHEDULED' || q.state.data?.status === 'PUBLISHING'
        ? 10_000
        : false,
  });
}

export function usePostableChannels() {
  return useQuery({
    queryKey: ['posts', 'channels'],
    queryFn: () => apiFetch<{ items: PostableChannel[] }>('/api/v1/posts/channels'),
    staleTime: 60_000,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PostPayload) =>
      apiFetch<PostItem>('/api/v1/posts', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
}

export function useUpdatePost(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<PostPayload>) =>
      apiFetch<PostItem>(`/api/v1/posts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/posts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
}

export function useCancelPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ cancelledTargets: number }>(`/api/v1/posts/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
}

export function useRetryTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, targetId }: { postId: string; targetId: string }) =>
      apiFetch<{ status: PostStatus }>(`/api/v1/posts/${postId}/targets/${targetId}/retry`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
}

// ─── Upload media lên MinIO (presigned PUT, có tiến trình) ────────────────────

export type UploadedMedia = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  type: 'IMAGE' | 'VIDEO';
  previewUrl: string;
};

export async function uploadMedia(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadedMedia> {
  const init = await apiFetch<{
    mediaId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>('/api/v1/media', {
    method: 'POST',
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }),
  });

  // XHR thay vì fetch để có upload progress
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', init.uploadUrl);
    for (const [k, v] of Object.entries(init.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload thất bại (HTTP ${xhr.status})`));
    xhr.onerror = () =>
      reject(new Error('Không kết nối được kho lưu trữ (MinIO). Kiểm tra S3_PUBLIC_ENDPOINT/CORS.'));
    xhr.send(file);
  });

  return apiFetch<UploadedMedia>(`/api/v1/media/${init.mediaId}/complete`, { method: 'POST' });
}
