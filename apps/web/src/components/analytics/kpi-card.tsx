'use client';

import { ResponsiveContainer, LineChart, Line, YAxis } from 'recharts';
import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatPct } from '@/lib/format';

type Props = {
  icon: LucideIcon;
  title: string;
  valueLabel: string;
  /** Giá trị phụ (ví dụ tương đương VND) */
  subLabel?: string;
  deltaPct?: number | null;
  sparkline?: number[];
  sparklineColor?: string;
  progress?: { value: number; max: number; label?: string };
  isLoading?: boolean;
};

export function KpiCard({
  icon: Icon,
  title,
  valueLabel,
  subLabel,
  deltaPct,
  sparkline,
  sparklineColor = '#3b82f6',
  progress,
  isLoading,
}: Props) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  const up = typeof deltaPct === 'number' && deltaPct > 0;
  const down = typeof deltaPct === 'number' && deltaPct < 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-2">
          {/* Mobile font lớn hơn (3xl) cho dễ đọc; tablet+ giữ 2xl */}
          <span className="text-3xl font-bold tracking-tight sm:text-2xl">{valueLabel}</span>
          {typeof deltaPct === 'number' && (
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
              {formatPct(deltaPct)}
            </span>
          )}
        </div>

        {subLabel && (
          <p className="text-xs text-muted-foreground">{subLabel}</p>
        )}

        {progress && (
          <div className="space-y-1 pt-1">
            <Progress value={progress.value} max={progress.max} />
            {progress.label && (
              <p className="text-[11px] text-muted-foreground">{progress.label}</p>
            )}
          </div>
        )}

        {sparkline && sparkline.length > 1 && (
          <div className="pt-1 opacity-80">
            <Sparkline data={sparkline} color={sparklineColor} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={36}>
      <LineChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function Progress({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          'h-full transition-all',
          pct >= 100 ? 'bg-emerald-500' : 'bg-primary',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
