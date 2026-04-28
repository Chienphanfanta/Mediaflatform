'use client';

// Tab "Tổng quan" — stats hiện tại + chart 30 ngày views.
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Eye, TrendingUp, Users, DollarSign } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useChannelDetail } from '@/hooks/use-channel-detail';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/utils';

type Props = { channelId: string };

export function TabOverview({ channelId }: Props) {
  const { data, isLoading, isError, error } = useChannelDetail(channelId, '30d');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          {error?.message ?? 'Lỗi tải dữ liệu'}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const overview = data.overview;
  const totalViews = overview.views.reduce((s, v) => s + v, 0);
  const totalWatchTime = overview.watchTimeHours.reduce((s, v) => s + v, 0);
  const totalSubsDelta = overview.subscriberDelta.reduce((s, v) => s + v, 0);
  const totalRevenue = overview.revenue.reduce((s, v) => s + v, 0);

  const chartData = overview.labels.map((label, i) => ({
    date: label,
    views: overview.views[i],
    subs: overview.subscriberDelta[i],
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Eye}
          label="Tổng views (30d)"
          value={formatCompact(totalViews)}
        />
        <StatCard
          icon={TrendingUp}
          label="Watch time"
          value={`${formatCompact(totalWatchTime)}h`}
        />
        <StatCard
          icon={Users}
          label="Δ Subscribers"
          value={formatCompact(totalSubsDelta)}
          valueClass={
            totalSubsDelta > 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : totalSubsDelta < 0
                ? 'text-destructive'
                : ''
          }
        />
        <StatCard
          icon={DollarSign}
          label="Revenue (USD)"
          value={`$${totalRevenue.toFixed(2)}`}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Views 30 ngày qua</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => format(parseISO(d), 'dd/MM')}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                tickFormatter={(v: number) => formatCompact(v)}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(d: string) =>
                  format(parseISO(d), 'EEEE, dd/MM/yyyy', { locale: vi })
                }
                formatter={(v: number) => [formatCompact(v), 'Views']}
              />
              <Area
                type="monotone"
                dataKey="views"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#viewsFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  valueClass,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={cn('text-xl font-bold tracking-tight', valueClass)}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
