'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import { usePermission } from '@/hooks/use-permission';
import type { ChannelInfo } from '@/lib/types/channel-detail';

type Props = {
  channel?: ChannelInfo;
  isLoading: boolean;
  period: '7d' | '30d' | '90d';
  onPeriodChange: (p: '7d' | '30d' | '90d') => void;
};

const STATUS_BADGE: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  ACTIVE: {
    label: 'Active',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    icon: CheckCircle2,
  },
  TOKEN_EXPIRED: {
    label: 'Token hết hạn',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    icon: AlertTriangle,
  },
  SUSPENDED: {
    label: 'Tạm dừng',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    icon: AlertTriangle,
  },
  DISCONNECTED: {
    label: 'Đã ngắt',
    className: 'bg-destructive/10 text-destructive border-destructive/30',
    icon: AlertTriangle,
  },
  ERROR: {
    label: 'Lỗi',
    className: 'bg-destructive/10 text-destructive border-destructive/30',
    icon: AlertTriangle,
  },
};

export function ChannelHeader({ channel, isLoading, period, onPeriodChange }: Props) {
  const qc = useQueryClient();
  const { atLeast } = usePermission();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (!channel) return;
    setSyncing(true);
    // Placeholder: Phase 1 sẽ enqueue BullMQ job /api/v1/channels/:id/sync
    // Hiện tại chỉ invalidate cache để fetch lại
    await qc.invalidateQueries({ queryKey: ['channel-detail', channel.id] });
    await qc.invalidateQueries({ queryKey: ['channel-posts', channel.id] });
    setTimeout(() => setSyncing(false), 600);
  };

  if (isLoading || !channel) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-20" />
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_BADGE[channel.status] ?? STATUS_BADGE.ACTIVE;
  const StatusIcon = statusInfo.icon;

  // Build export URL — last 90 days mặc định
  const today = new Date();
  const past = new Date();
  past.setDate(past.getDate() - 90);
  const exportUrl =
    `/api/v1/analytics/export?channelIds=${channel.id}` +
    `&from=${past.toISOString()}&to=${today.toISOString()}&format=csv`;

  return (
    <div className="space-y-3">
      <Link
        href="/analytics"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Quay lại Analytics
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white',
              PLATFORM_DOT[channel.platform],
            )}
          >
            <span className="text-sm font-bold">
              {PLATFORM_LABEL[channel.platform][0]}
            </span>
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
              {channel.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{PLATFORM_LABEL[channel.platform]}</Badge>
              <Badge variant="outline" className={cn('border', statusInfo.className)}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {statusInfo.label}
              </Badge>
              {channel.monetizationEnabled && (
                <Badge
                  variant="outline"
                  className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                >
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  Monetized
                </Badge>
              )}
              {channel.subscriberCount !== null && (
                <span className="text-muted-foreground">
                  {channel.subscriberCount.toLocaleString('vi-VN')} subscribers
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border">
            {(['7d', '30d', '90d'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPeriodChange(p)}
                className={cn(
                  'px-3 py-1.5 text-sm transition-colors',
                  period === p
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-accent',
                )}
              >
                {p === '7d' ? '7 ngày' : p === '30d' ? '30 ngày' : '90 ngày'}
              </button>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            Sync ngay
          </Button>

          {atLeast('MANAGER') && (
            <Button asChild variant="outline" size="sm">
              <a href={exportUrl} download>
                <Download className="h-4 w-4" />
                Export CSV
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
