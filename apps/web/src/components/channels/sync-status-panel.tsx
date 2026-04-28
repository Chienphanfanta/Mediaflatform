'use client';

import { formatDistanceToNow, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  Activity,
  ChevronRight,
  Loader2,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatCompact, formatPct } from '@/lib/format';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import type { SyncStatusResponse } from '@/lib/types/channels-page';

type Props = {
  status?: SyncStatusResponse;
  isLoading: boolean;
  isFetching: boolean;
  onSyncAll: () => void;
  syncAllPending: boolean;
  onClose?: () => void;
};

export function SyncStatusPanel({
  status,
  isLoading,
  isFetching,
  onSyncAll,
  syncAllPending,
  onClose,
}: Props) {
  return (
    <Card className="sticky top-20">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className={cn('h-4 w-4', isFetching && 'animate-pulse text-primary')} />
          Trạng thái sync
        </CardTitle>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Đóng panel</span>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sync all button */}
        <Button
          onClick={onSyncAll}
          disabled={syncAllPending}
          className="w-full"
          variant="default"
        >
          {syncAllPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Zap className="h-4 w-4" />
          )}
          Sync tất cả
        </Button>

        {/* In progress */}
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : status && status.inProgress.length > 0 ? (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Đang sync ({status.inProgress.length})
            </h4>
            <ul className="space-y-1.5">
              {status.inProgress.map((it) => (
                <li
                  key={it.channelId}
                  className="flex items-center gap-2 rounded-md bg-primary/5 px-2 py-1.5"
                >
                  <span
                    className={cn('h-2 w-2 rounded-full', PLATFORM_DOT[it.platform])}
                  />
                  <span className="flex-1 truncate text-xs">{it.channelName}</span>
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Recent syncs */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sync gần đây
          </h4>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : status && status.recentSyncs.length > 0 ? (
            <ul className="space-y-1">
              {status.recentSyncs.slice(0, 8).map((it) => (
                <li
                  key={it.channelId}
                  className="flex items-center gap-2 px-1 py-1 text-xs"
                >
                  <span
                    className={cn('h-2 w-2 rounded-full', PLATFORM_DOT[it.platform])}
                  />
                  <span className="flex-1 truncate">{it.channelName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(parseISO(it.lastSyncedAt), {
                      addSuffix: true,
                      locale: vi,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Chưa có lịch sử sync.</p>
          )}
        </div>

        {/* YouTube quota */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            YouTube quota hôm nay
          </h4>
          {isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : status ? (
            <YouTubeQuota quota={status.quotas.YOUTUBE} />
          ) : null}
        </div>

        {status && (
          <p className="border-t pt-2 text-[10px] text-muted-foreground">
            Cập nhật{' '}
            {formatDistanceToNow(parseISO(status.checkedAt), {
              addSuffix: true,
              locale: vi,
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function YouTubeQuota({ quota }: { quota: SyncStatusResponse['quotas']['YOUTUBE'] }) {
  if (quota.used === null) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Quota tracking chưa active.
        </p>
        {quota.note && (
          <p className="mt-1 text-[10px] text-muted-foreground/70">{quota.note}</p>
        )}
      </div>
    );
  }

  const usedPct = (quota.used / quota.total) * 100;
  const danger = usedPct >= 90;
  const warn = usedPct >= 70;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-mono">
          {formatCompact(quota.used)} / {formatCompact(quota.total)}
        </span>
        <span
          className={cn(
            'font-medium',
            danger
              ? 'text-destructive'
              : warn
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400',
          )}
        >
          {formatPct(usedPct, { signed: false })}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full transition-all',
            danger ? 'bg-destructive' : warn ? 'bg-amber-500' : 'bg-emerald-500',
          )}
          style={{ width: `${Math.min(100, usedPct)}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Reset {formatDistanceToNow(parseISO(quota.resetAt), { addSuffix: true, locale: vi })}
      </p>
    </div>
  );
}

// Placeholder
void ChevronRight;
void RefreshCw;
