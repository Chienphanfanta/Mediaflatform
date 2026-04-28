'use client';

// Tab "Sync logs" — N sync logs gần nhất từ /api/v1/channels/[id]/sync-logs.
import { format, formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  CheckCircle2,
  Loader2,
  ListX,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import type { SyncStatus } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useChannelSyncLogs } from '@/hooks/use-channel-sync-logs';
import { cn } from '@/lib/utils';

const STATUS_META: Record<SyncStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  SUCCESS: {
    label: 'Success',
    className:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  FAILED: {
    label: 'Failed',
    className: 'border-destructive/40 bg-destructive/10 text-destructive',
    Icon: XCircle,
  },
  SKIPPED: {
    label: 'Skipped',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    Icon: AlertTriangle,
  },
};

type Props = { channelId: string };

export function TabSyncLogs({ channelId }: Props) {
  const { data, isLoading, isError, error } = useChannelSyncLogs(channelId, 30);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          {error?.message ?? 'Lỗi tải sync logs'}
        </CardContent>
      </Card>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <ListX className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Chưa có sync log nào</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Sync sẽ tạo log entries — có thể chưa chạy lần nào hoặc Redis chưa có job.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Loader2 className="h-4 w-4" />
          Sync logs (30 gần nhất)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Khi nào</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Records</th>
                <th className="px-3 py-2 text-right font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Error / note</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((log) => {
                const meta = STATUS_META[log.status];
                return (
                  <tr key={log.id} className="transition-colors hover:bg-accent/30">
                    <td className="px-3 py-2 text-xs">
                      <div
                        className="font-medium"
                        title={format(
                          new Date(log.createdAt),
                          'dd/MM/yyyy HH:mm:ss',
                        )}
                      >
                        {formatDistanceToNow(new Date(log.createdAt), {
                          addSuffix: true,
                          locale: vi,
                        })}
                      </div>
                      <div className="text-muted-foreground">
                        {format(new Date(log.createdAt), 'HH:mm dd/MM')}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'inline-flex items-center gap-1 text-[10px]',
                          meta.className,
                        )}
                      >
                        <meta.Icon className="h-2.5 w-2.5" />
                        {meta.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {log.recordsUpdated}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {log.durationMs}ms
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {log.errorMessage ? (
                        <span className="text-destructive">
                          {truncate(log.errorMessage, 100)}
                        </span>
                      ) : log.metadata && Object.keys(log.metadata as object).length > 0 ? (
                        <span
                          className="text-muted-foreground"
                          title={JSON.stringify(log.metadata)}
                        >
                          {summarizeMeta(log.metadata)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function summarizeMeta(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '—';
  const obj = meta as Record<string, unknown>;
  if ('skippedReason' in obj) return String(obj.skippedReason);
  if ('daysFetched' in obj) return `${obj.daysFetched} days`;
  return Object.keys(obj).join(', ');
}
