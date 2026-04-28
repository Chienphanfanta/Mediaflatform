'use client';

import { useMemo, useState } from 'react';
import type { Platform } from '@prisma/client';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { formatCompact } from '@/lib/format';
import { PLATFORM_LABEL } from '@/lib/platform';
import type { ViewsByPlatformDaily } from '@/lib/types/analytics-summary';

type Props = {
  data?: ViewsByPlatformDaily;
  isLoading: boolean;
};

export function ViewsChart({ data, isLoading }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const isMobile = useMobile();

  // Top 2 datasets theo total views — chỉ render trên mobile để tránh spaghetti chart
  const visibleDatasets = useMemo(() => {
    if (!data || !isMobile) return data?.datasets ?? [];
    return [...data.datasets]
      .sort((a, b) => sumArr(b.data) - sumArr(a.data))
      .slice(0, 2);
  }, [data, isMobile]);

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tổng view theo ngày</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[320px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (data.datasets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tổng view theo ngày</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            Chưa có dữ liệu view trong khoảng này.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Mobile: chỉ giữ 7 ngày cuối để chart đỡ rậm; tablet+ full range.
  const dataLength = data.labels.length;
  const startIdx = isMobile ? Math.max(0, dataLength - 7) : 0;
  const labels = data.labels.slice(startIdx);

  // Pivot sang recharts shape: [{ name: label, [platform]: views, ... }]
  const chartData = labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label };
    const realIdx = startIdx + i;
    for (const ds of data.datasets) row[ds.label] = ds.data[realIdx] ?? 0;
    return row;
  });

  const toggle = (platform: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            Tổng view theo ngày
            {isMobile && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                · 7 ngày · top 2 nền tảng
              </span>
            )}
          </CardTitle>
          {/* Legend toggle ẨN trên mobile (visibleDatasets đã chọn top 2) */}
          <div className="hidden flex-wrap gap-3 sm:flex">
            {data.datasets.map((ds) => {
              const isHidden = hidden.has(ds.label);
              return (
                <label
                  key={ds.label}
                  className="flex cursor-pointer items-center gap-1.5 text-xs"
                >
                  <Checkbox
                    checked={!isHidden}
                    onCheckedChange={() => toggle(ds.label)}
                  />
                  <span
                    className={cn('h-2.5 w-2.5 rounded-sm')}
                    style={{ backgroundColor: ds.color }}
                  />
                  <span className={cn(isHidden && 'text-muted-foreground line-through')}>
                    {PLATFORM_LABEL[ds.label as Platform] ?? ds.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Mobile: 200px; tablet+: 320px */}
        <ResponsiveContainer width="100%" height={isMobile ? 200 : 320}>
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="name"
              tickFormatter={(d: string) => format(parseISO(d), 'dd/MM')}
              tick={{ fontSize: isMobile ? 10 : 11 }}
              stroke="currentColor"
              className="text-muted-foreground"
              minTickGap={isMobile ? 30 : 20}
            />
            <YAxis
              tickFormatter={(v: number) => formatCompact(v)}
              tick={{ fontSize: isMobile ? 10 : 11 }}
              stroke="currentColor"
              className="text-muted-foreground"
              width={isMobile ? 36 : 50}
            />
            <Tooltip
              // Mobile tooltip lớn hơn — finger-friendly. Recharts mobile tự
              // mở tooltip khi tap (touch event = activeIndex).
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 10,
                fontSize: isMobile ? 14 : 12,
                padding: isMobile ? '10px 14px' : '6px 10px',
              }}
              labelStyle={{
                fontWeight: isMobile ? 600 : 500,
                marginBottom: isMobile ? 4 : 2,
              }}
              labelFormatter={(d: string) =>
                format(parseISO(d), 'EEEE, dd/MM/yyyy')
              }
              formatter={(v: number, name: string) => [
                formatCompact(v),
                PLATFORM_LABEL[name as Platform] ?? name,
              ]}
            />
            <Legend wrapperStyle={{ display: 'none' }} />
            {visibleDatasets.map((ds) =>
              hidden.has(ds.label) ? null : (
                <Line
                  key={ds.label}
                  type="monotone"
                  dataKey={ds.label}
                  stroke={ds.color}
                  strokeWidth={isMobile ? 2.5 : 2}
                  dot={false}
                  activeDot={{ r: isMobile ? 6 : 4 }}
                />
              ),
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function sumArr(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0);
}
