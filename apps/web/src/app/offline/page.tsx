// /offline — fallback navigation khi service worker không reach được network.
//
// Service worker ở next.config.js → fallbacks.document = '/offline' nên khi
// navigation request fail (no network + page chưa precache) → SW serve trang này.
//
// React Query có thể hiển thị data từ cache nếu user đã visit dashboard trước:
// queryKey 'dashboard-overview' và 'calendar' đã được Workbox cache qua
// runtimeCaching pattern /api/v1/* (NetworkFirst → fallback Cache).
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Calendar, RefreshCw, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';

type CachedPost = {
  id: string;
  title: string;
  platform: string;
  scheduledAt: string | null;
  channelName?: string;
};

export default function OfflinePage() {
  const [online, setOnline] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Detect online status
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Try last-cached dashboard data — react-query đọc cache hoặc fail im lặng.
  // Fetch chỉ chạy khi online (tránh 404 noise khi offline).
  const { data: cachedPosts } = useQuery<CachedPost[]>({
    queryKey: ['offline-scheduled-posts'],
    queryFn: async () => {
      const res = await apiFetch<{ events: CachedPost[] }>(
        '/api/v1/calendar?start=' +
          new Date().toISOString() +
          '&end=' +
          new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      );
      return (res.events ?? []).slice(0, 10);
    },
    staleTime: Infinity,
    enabled: online,
    retry: false,
  });

  const handleRetry = async () => {
    setRetryCount((c) => c + 1);
    if (typeof window === 'undefined') return;
    if (navigator.onLine) {
      // Browser tin là online → reload để re-fetch SSR
      window.location.reload();
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 p-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-full ${
            online ? 'bg-emerald-500/10' : 'bg-destructive/10'
          }`}
        >
          <WifiOff
            className={`h-8 w-8 ${
              online ? 'text-emerald-600' : 'text-destructive'
            }`}
          />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {online ? 'Đã có kết nối lại' : 'Bạn đang offline'}
          </h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {online
              ? 'Kết nối internet đã trở lại. Tải lại trang để xem nội dung mới nhất.'
              : 'Không có kết nối internet. Một số nội dung từ lần truy cập trước vẫn xem được dưới đây.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={handleRetry}>
            <RefreshCw className="h-4 w-4" />
            Thử lại kết nối
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Mở Dashboard (cached)</Link>
          </Button>
        </div>
        {retryCount > 0 && !online && (
          <p className="text-xs text-muted-foreground">
            Vẫn chưa có mạng. Thử lại sau ít phút.
          </p>
        )}
      </div>

      {/* Cached scheduled posts (best-effort) */}
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Bài đã lên lịch (cached)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!cachedPosts || cachedPosts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Chưa có dữ liệu cache. Mở app online ít nhất 1 lần để cache lịch.
            </p>
          ) : (
            <ul className="divide-y">
              {cachedPosts.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.platform}
                      {p.channelName && ` · ${p.channelName}`}
                    </div>
                  </div>
                  {p.scheduledAt && (
                    <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {format(parseISO(p.scheduledAt), 'HH:mm dd/MM', {
                        locale: vi,
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
