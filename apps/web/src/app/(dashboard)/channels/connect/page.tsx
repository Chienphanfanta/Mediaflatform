'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import type { Platform } from '@prisma/client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { PLATFORM_DOT, PLATFORM_LABEL, PLATFORMS } from '@/lib/platform';
import { usePermission } from '@/hooks/use-permission';

type PlatformStep = {
  title: string;
  detail: string;
};

const STEPS: Record<Platform, PlatformStep[]> = {
  YOUTUBE: [
    { title: 'Đăng nhập Google', detail: 'Bằng tài khoản sở hữu YouTube channel' },
    { title: 'Cấp quyền', detail: 'Chỉ đọc thông tin kênh + analytics' },
    { title: 'Hoàn tất', detail: 'Channel + metadata được fetch tự động' },
  ],
  FACEBOOK: [
    { title: 'Đăng nhập Facebook', detail: 'Tài khoản admin của Page' },
    { title: 'Chọn Page', detail: 'Hiện tại auto-pick Page đầu tiên' },
    { title: 'Hoàn tất', detail: 'Long-lived Page Access Token được lưu encrypted' },
  ],
  TIKTOK: [
    { title: 'Đăng nhập TikTok', detail: 'Bằng tài khoản TikTok cần theo dõi' },
    { title: 'Cấp quyền', detail: 'Đọc hồ sơ, số liệu follower/like và danh sách video' },
    { title: 'Hoàn tất', detail: 'Refresh token được lưu encrypted để tự gia hạn' },
  ],
};

export default function ChannelsConnectPage() {
  const params = useSearchParams();
  const { atLeast, user } = usePermission();
  const userGroups = user?.groups ?? [];

  const [groupId, setGroupId] = useState<string>(userGroups[0]?.id ?? '');
  const [platform, setPlatform] = useState<Platform | null>(null);

  // Default group khi user load
  useEffect(() => {
    if (!groupId && userGroups.length > 0) setGroupId(userGroups[0].id);
  }, [userGroups, groupId]);

  const success = params.get('success');
  const channelId = params.get('channelId');
  const successPlatform = params.get('platform');
  const errorCode = params.get('error');

  if (!atLeast('MANAGER')) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium">Tính năng giới hạn</p>
          <p className="text-xs text-muted-foreground">
            Kết nối channel mới yêu cầu quyền <strong>Manager</strong> trở lên.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Quay lại
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
          Kết nối kênh truyền thông
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          OAuth flow tự động fetch metadata + token được mã hoá AES-256-GCM trước khi lưu DB.
        </p>
      </header>

      {/* Banner kết quả callback */}
      {success === '1' && channelId && (
        <Alert className="border-emerald-500/30 bg-emerald-500/5">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <AlertTitle className="text-emerald-700 dark:text-emerald-400">
            Kết nối thành công!
          </AlertTitle>
          <AlertDescription>
            {successPlatform?.toUpperCase()} channel đã được lưu (id: {channelId}).{' '}
            <Link
              href={`/analytics/channels/${channelId}`}
              className="font-medium underline"
            >
              Xem chi tiết →
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {errorCode && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Kết nối thất bại</AlertTitle>
          <AlertDescription>
            Mã lỗi: <code className="rounded bg-destructive/10 px-1">{errorCode}</code>.
            {errorCode === 'INVALID_OR_EXPIRED_STATE' && ' State đã hết hạn (>10 phút) — thử lại.'}
            {errorCode === 'EXCHANGE_FAILED' && ' Provider trả lỗi khi exchange code — kiểm tra logs.'}
            {errorCode === 'STATE_NONCE_MISMATCH' && ' CSRF check fail — không tin tưởng request.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Step 1: Group */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Chọn group cho channel</CardTitle>
        </CardHeader>
        <CardContent>
          {userGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Bạn chưa thuộc group nào. Liên hệ admin để được add vào group trước.
            </p>
          ) : (
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="flex h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {userGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.role})
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Platform */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Chọn nền tảng</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((p) => {
            const active = platform === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(active ? null : p)}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors',
                  active && 'border-primary bg-primary/5',
                  !active && 'hover:border-primary/50 hover:bg-accent/30',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold text-white',
                      PLATFORM_DOT[p],
                    )}
                  >
                    {PLATFORM_LABEL[p][0]}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold">{PLATFORM_LABEL[p]}</div>
                    <Badge variant="outline" className="mt-1 text-[10px]">
                      OAuth 2.0
                    </Badge>
                  </div>
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* Step 3: Connect action — depends on platform */}
      {platform && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              3. Hướng dẫn kết nối — {PLATFORM_LABEL[platform]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-2.5">
              {STEPS[platform].filter((s) => s.title).map((s, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground">{s.detail}</div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button asChild disabled={!groupId} className="gap-2">
                <a
                  href={`/api/v1/platforms/${platform.toLowerCase()}/connect?groupId=${encodeURIComponent(groupId)}`}
                >
                  <ExternalLink className="h-4 w-4" />
                  Kết nối với {PLATFORM_LABEL[platform]}
                </a>
              </Button>
              <span className="text-xs text-muted-foreground">
                Sẽ redirect đến trang authorize của {PLATFORM_LABEL[platform]}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Security note */}
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" />
          <div className="space-y-1 text-sm">
            <div className="font-medium">Token được bảo vệ</div>
            <ul className="ml-4 list-disc space-y-0.5 text-xs text-muted-foreground">
              <li>Mã hoá AES-256-GCM trước khi ghi DB (key 32 bytes từ env)</li>
              <li>State cookie HttpOnly + signed HMAC, TTL 10 phút (chống CSRF)</li>
              <li>Chỉ xin quyền ĐỌC — hệ thống không bao giờ đăng/sửa nội dung</li>
              <li>Token không log ra console (mask 5 đầu + 3 cuối nếu cần)</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

