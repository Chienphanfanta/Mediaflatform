'use client';

// Tab "Tăng trưởng" — line charts followers + views over time với period picker.
import { useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useChannelDetail } from '@/hooks/use-channel-detail';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/utils';

type Period = '7d' | '30d' | '90d';

type Props = { channelId: string };

export function TabGrowth({ channelId }: Props) {
  const [period, setPeriod] = useState<Period>('30d');
  const { data, isLoading, isError, error } = useChannelDetail(channelId, period);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        {(['7d', '30d', '90d'] as const).map((p) => (
          <Button
            key={p}
            variant={period === p ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPeriod(p)}
            className="h-8"
          >
            {p === '7d' ? '7 ngày' : p === '30d' ? '30 ngày' : '90 ngày'}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            {error?.message ?? 'Lỗi tải dữ liệu'}
          </CardContent>
        </Card>
      ) : !data ? null : (
        <>
          {/* Cumulative subscribers chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Subscribers theo thời gian</CardTitle>
            </CardHeader>
            <CardContent>
              <GrowthLineChart
                data={data.overview.labels.map((l, i) => ({
                  date: l,
                  subs: data.overview.subscribers[i],
                }))}
                yKey="subs"
                yLabel="Subscribers"
                color="hsl(var(--primary))"
              />
            </CardContent>
          </Card>

          {/* Daily views chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Views hàng ngày</CardTitle>
            </CardHeader>
            <CardContent>
              <GrowthLineChart
                data={data.overview.labels.map((l, i) => ({
                  date: l,
                  views: data.overview.views[i],
                }))}
                yKey="views"
                yLabel="Views"
                color="#10B981"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function GrowthLineChart({
  data,
  yKey,
  yLabel,
  color,
}: {
  data: Array<Record<string, string | number>>;
  yKey: string;
  yLabel: string;
  color: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className={cn('stroke-border')} />
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
          formatter={(v: number) => [formatCompact(v), yLabel]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey={yKey}
          name={yLabel}
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
