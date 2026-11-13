// Gọi API server (/api/v1/ext/*) bằng device token.
import { getLocal } from './storage';
import type { ExtensionFlowsConfig, MeInfo, QueueItem } from './types';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

export const EXTENSION_VERSION = chrome.runtime.getManifest().version;

export function normalizeServerUrl(raw: string): string {
  const u = new URL(raw.trim());
  return u.origin;
}

async function request<T>(
  path: string,
  init: RequestInit & { serverUrl?: string; token?: string | null } = {},
): Promise<T> {
  const stored = await getLocal(['serverUrl', 'deviceToken']);
  const serverUrl = init.serverUrl ?? stored.serverUrl;
  const token = init.token === undefined ? stored.deviceToken : init.token;
  if (!serverUrl) throw new ApiError('NOT_CONFIGURED', 'Chưa cấu hình địa chỉ server', 0);

  let res: Response;
  try {
    res = await fetch(`${serverUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Version': EXTENSION_VERSION,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('NETWORK', `Không kết nối được server ${serverUrl}`, 0);
  }
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!json) throw new ApiError(`HTTP_${res.status}`, `Server trả lỗi HTTP ${res.status}`, res.status);
  if (!json.success) throw new ApiError(json.error.code, json.error.message, res.status);
  return json.data;
}

export function pairDevice(
  serverUrl: string,
  body: { code: string; name: string; browser: string; os?: string },
) {
  return request<{
    token: string;
    device: { id: string; name: string };
    user: { id: string; name: string; email: string };
  }>('/api/v1/ext/pair', {
    method: 'POST',
    serverUrl,
    token: null,
    body: JSON.stringify({ ...body, extensionVersion: EXTENSION_VERSION }),
  });
}

export const getMe = () => request<MeInfo>('/api/v1/ext/me');

export const getQueue = () => request<{ items: QueueItem[]; serverTime: string }>('/api/v1/ext/queue');

export const getFlows = () => request<ExtensionFlowsConfig>('/api/v1/ext/flows');

export const claimTarget = (id: string) =>
  request<{ id: string; attempts: number }>(`/api/v1/ext/targets/${id}/claim`, { method: 'POST' });

export const reportResult = (
  id: string,
  body: { success: true; externalUrl?: string | null } | { success: false; error: string; retryable: boolean },
) =>
  request<{ postStatus: string }>(`/api/v1/ext/targets/${id}/result`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
