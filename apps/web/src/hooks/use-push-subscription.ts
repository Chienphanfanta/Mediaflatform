// Hook quản lý push subscription lifecycle.
//
// Flow:
//   1. Đọc state hiện tại (Notification.permission + active subscription nếu có)
//   2. enable(): xin permission → subscribe qua VAPID public key → POST lên server
//   3. disable(): unsubscribe + DELETE server
//
// Ràng buộc:
//   - Chỉ chạy client (use 'client'); SSR-safe qua check typeof window.
//   - Yêu cầu service worker đã register (next-pwa tự handle khi app load).
//   - VAPID key từ env NEXT_PUBLIC_VAPID_PUBLIC_KEY (public OK lộ).
'use client';

import { useCallback, useEffect, useState } from 'react';

export type PushState =
  | 'unsupported' // browser không có Notification/PushManager
  | 'default' // chưa hỏi permission
  | 'granted-subscribed' // đã grant + có subscription active
  | 'granted-not-subscribed' // grant nhưng subscription bị revoke
  | 'denied'; // user reject permission (cần vào browser settings để mở lại)

export type PushSubscriptionState = {
  state: PushState;
  loading: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

export function usePushSubscription(): PushSubscriptionState {
  const [state, setStateRaw] = useState<PushState>('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial detect
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setStateRaw('unsupported');
      return;
    }
    detect().then(setStateRaw);
  }, []);

  const enable = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStateRaw('denied');
        throw new Error('User từ chối hoặc trình duyệt block notifications');
      }
      const reg = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY chưa set');

      // Copy vào ArrayBuffer-backed Uint8Array để fix lib.dom narrowing
      // (PushManager.subscribe expect BufferSource; strict TS từ chối
      // SharedArrayBuffer-backed view).
      const keyBytes = urlBase64ToUint8Array(vapidKey);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(0) as ArrayBuffer,
      });

      const body = {
        endpoint: sub.endpoint,
        keys: subscriptionKeys(sub),
        userAgent:
          typeof navigator !== 'undefined'
            ? navigator.userAgent.slice(0, 500)
            : undefined,
      };
      const res = await fetch('/api/v1/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error?.message ?? 'Lỗi lưu subscription');
      }
      setStateRaw('granted-subscribed');
    } catch (e) {
      setError((e as Error).message);
      setStateRaw(await detect());
    } finally {
      setLoading(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch(
          '/api/v1/notifications/subscribe?endpoint=' +
            encodeURIComponent(endpoint),
          { method: 'DELETE' },
        );
      }
      setStateRaw('granted-not-subscribed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { state, loading, error, enable, disable };
}

// ────────── Helpers ──────────

async function detect(): Promise<PushState> {
  if (typeof window === 'undefined') return 'default';
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  // granted — kiểm tra subscription
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'granted-subscribed' : 'granted-not-subscribed';
  } catch {
    return 'granted-not-subscribed';
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function subscriptionKeys(sub: PushSubscription): {
  p256dh: string;
  auth: string;
} {
  const j = sub.toJSON();
  return {
    p256dh: j.keys?.p256dh ?? '',
    auth: j.keys?.auth ?? '',
  };
}
