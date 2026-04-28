'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCompact } from '@/lib/format';
import type { ChannelHealthItem } from '@/lib/types/dashboard';

type Props = { data?: ChannelHealthItem[]; isLoading: boolean };

const HEALTH_COLOR = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-destructive',
} as const;

const HEALTH_LABEL = {
  green: 'Hoạt động',
  yellow: 'Cảnh báo',
  red: 'Có lỗi',
} as const;

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
};

export function ChannelHealth({ data, isLoading }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Channel health</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Bạn chưa kết nối kênh nào.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
              >
                <div
                  className={cn('relative h-2.5 w-2.5 shrink-0 rounded-full', HEALTH_COLOR[c.health])}
                  aria-label={HEALTH_LABEL[c.health]}
                >
                  {c.health !== 'red' && (
                    <span
                      className={cn(
                        'absolute inset-0 animate-ping rounded-full opacity-60',
                        HEALTH_COLOR[c.health],
                      )}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      {c.platform}
                    </Badge>
                    <span>·</span>
                    <span>{formatCompact(c.viewsToday)} views hôm nay</span>
                  </div>
                </div>
                {c.status !== 'ACTIVE' && (
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
