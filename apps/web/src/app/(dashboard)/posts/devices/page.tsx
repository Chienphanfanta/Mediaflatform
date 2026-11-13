'use client';

// /posts/devices — ghép extension cho trình duyệt (Chrome / Cốc Cốc) + danh sách + thu hồi.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, KeyRound, Laptop, Loader2, ShieldOff } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatVnDateTime } from '@/components/posts/post-status';
import { ReminderSettingsCard } from '@/components/posts/reminder-settings-card';
import {
  useBrowserDevices,
  useCreatePairCode,
  useRevokeDevice,
} from '@/hooks/use-browser-devices';
import { usePermission } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';

const BROWSER_LABEL = { CHROME: 'Chrome', COCCOC: 'Cốc Cốc', OTHER: 'Khác' } as const;

export default function DevicesPage() {
  const { atLeast } = usePermission();
  const isManager = atLeast('MANAGER');
  const [mine, setMine] = useState(!isManager);
  const devicesQ = useBrowserDevices(mine);
  const pairM = useCreatePairCode();
  const revokeM = useRevokeDevice();
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!pairM.data) return;
    const tick = () =>
      setSecondsLeft(
        Math.max(0, Math.round((new Date(pairM.data.expiresAt).getTime() - Date.now()) / 1000)),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pairM.data]);

  return (
    <div className="space-y-5">
      <header>
        <Link
          href="/posts"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Đăng bài
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Laptop className="h-7 w-7" />
          Trình duyệt đăng bài
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mỗi trình duyệt Chrome / Cốc Cốc cài extension và ghép với tài khoản nhân viên. Extension
          sẽ tự đăng bài lên các kênh nhân viên đó phụ trách.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Ghép trình duyệt mới
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
            <li>Cài extension vào Chrome hoặc Cốc Cốc trên máy cần đăng bài.</li>
            <li>Đăng nhập sẵn Facebook / TikTok / YouTube của các kênh bạn phụ trách.</li>
            <li>Bấm “Tạo mã ghép” bên dưới, mở extension và nhập mã (hết hạn sau 10 phút).</li>
          </ol>
          {pairM.data && secondsLeft > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-4">
              <span className="font-mono text-3xl font-bold tracking-[0.3em]">
                {pairM.data.code}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => navigator.clipboard.writeText(pairM.data.code)}
              >
                <Copy className="h-4 w-4" />
                Sao chép
              </Button>
              <span className="text-xs text-muted-foreground">
                Còn {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
              </span>
            </div>
          ) : (
            <Button onClick={() => pairM.mutate()} disabled={pairM.isPending} className="gap-2">
              {pairM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Tạo mã ghép
            </Button>
          )}
          {pairM.error && (
            <Alert variant="destructive">
              <AlertDescription>{pairM.error.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <ReminderSettingsCard />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {mine ? 'Trình duyệt của tôi' : 'Tất cả trình duyệt'}
          </CardTitle>
          {isManager && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              Chỉ của tôi
            </label>
          )}
        </CardHeader>
        <CardContent>
          {devicesQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : devicesQ.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có trình duyệt nào được ghép.</p>
          ) : (
            <div className="divide-y">
              {devicesQ.data?.items.map((d) => (
                <div
                  key={d.id}
                  className={cn('flex flex-wrap items-center gap-3 py-3', d.revokedAt && 'opacity-50')}
                >
                  <span
                    className={cn(
                      'h-2.5 w-2.5 rounded-full',
                      d.online ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                    )}
                    title={d.online ? 'Online' : 'Offline'}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {d.name}
                      <Badge variant="outline" className="text-[10px]">
                        {BROWSER_LABEL[d.browser]}
                      </Badge>
                      {d.revokedAt && (
                        <Badge variant="outline" className="text-[10px]">
                          Đã thu hồi
                        </Badge>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {!mine && `${d.user.name} · `}
                      {d.os ?? 'Không rõ HĐH'} · extension {d.extensionVersion ?? '?'} · hoạt động{' '}
                      {formatVnDateTime(d.lastSeenAt)} · đã đăng {d.publishedCount} bài
                    </p>
                  </div>
                  {!d.revokedAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-destructive"
                      disabled={revokeM.isPending}
                      onClick={() => {
                        if (confirm(`Thu hồi "${d.name}"? Extension trên máy đó sẽ ngừng đăng bài.`))
                          revokeM.mutate(d.id);
                      }}
                    >
                      <ShieldOff className="h-4 w-4" />
                      Thu hồi
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
