'use client';

import { Eye, Clock, TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatCompact, formatHours, formatPct } from '@/lib/format';
import type { DashboardOverview } from '@/lib/types/dashboard';

type Props = { data?: DashboardOverview['metrics']; isLoading: boolean };

export function MetricCards({ data, isLoading }: Props) {
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Metric
        icon={Eye}
        title="Views hôm nay"
        value={formatCompact(data.viewsToday.value)}
        delta={data.viewsToday.deltaPct}
        hint={`Hôm qua: ${formatCompact(data.viewsToday.vsValue)}`}
      />
      <Metric
        icon={Clock}
        title="Watch time hôm nay"
        value={formatHours(data.watchTimeHoursToday.value)}
        delta={data.watchTimeHoursToday.deltaPct}
        hint={`Hôm qua: ${formatHours(data.watchTimeHoursToday.vsValue)}`}
      />
    </div>
  );
}

function Metric({
  icon: Icon,
  title,
  value,
  delta,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  delta?: number | null;
  hint?: string;
}) {
  const up = typeof delta === 'number' && delta > 0;
  const down = typeof delta === 'number' && delta < 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight">{value}</span>
          {typeof delta === 'number' && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-xs font-medium',
                up && 'text-emerald-600 dark:text-emerald-400',
                down && 'text-destructive',
                !up && !down && 'text-muted-foreground',
              )}
            >
              {up && <TrendingUp className="h-3 w-3" />}
              {down && <TrendingDown className="h-3 w-3" />}
              {formatPct(delta)}
            </span>
          )}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
