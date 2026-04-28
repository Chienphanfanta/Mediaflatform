'use client';

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompact, formatHours, formatUsd } from '@/lib/format';
import type { OverviewData, ChannelInfo } from '@/lib/types/channel-detail';

type Props = {
  data?: OverviewData;
  channel?: ChannelInfo;
  isLoading: boolean;
};

export function TabOverview({ data, channel, isLoading }: Props) {
  if (isLoading || !data || !channel) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[320px] w-full rounded-lg" />
        <Skeleton className="h-[320px] w-full rounded-lg" />
        {channel?.platform === 'YOUTUBE' && (
          <Skeleton className="h-[280px] w-full rounded-lg lg:col-span-2" />
        )}
      </div>
    );
  }

  const isYouTube = channel.platform === 'YOUTUBE';

  const dualData = data.labels.map((label, i) => ({
    name: label,
    views: data.views[i],
    watchTime: data.watchTimeHours[i],
  }));

  const subData = data.labels.map((label, i) => ({
    name: label,
    subscribers: data.subscribers[i],
    delta: data.subscriberDelta[i],
  }));

  const revData = data.labels.map((label, i) => ({
    name: label,
    revenue: data.revenue[i],
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Dual axis: Views (bar/area) + Watch Time (line) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Views & Watch Time</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={dualData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="name"
                tickFormatter={(d: string) => format(parseISO(d), 'dd/MM')}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
                minTickGap={20}
              />
              <YAxis
                yAxisId="left"
                tickFormatter={(v: number) => formatCompact(v)}
                tick={{ fontSize: 11 }}
                stroke="#3b82f6"
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v: number) => `${formatCompact(v)}h`}
                tick={{ fontSize: 11 }}
                stroke="#8b5cf6"
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(d: string) => format(parseISO(d), 'dd/MM/yyyy')}
                formatter={(v: number, name: string) =>
                  name === 'watchTime'
                    ? [formatHours(v), 'Watch Time']
                    : [formatCompact(v), 'Views']
                }
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(v) => (v === 'views' ? 'Views' : 'Watch Time')}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="views"
                fill="#3b82f6"
                fillOpacity={0.18}
                stroke="#3b82f6"
                strokeWidth={2}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="watchTime"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Subscribers growth + milestones */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tăng trưởng Subscribers</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={subData} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="name"
                tickFormatter={(d: string) => format(parseISO(d), 'dd/MM')}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
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
                labelFormatter={(d: string) => format(parseISO(d), 'dd/MM/yyyy')}
                formatter={(v: number, name: string) =>
                  name === 'delta'
                    ? [`${v >= 0 ? '+' : ''}${v}`, 'Δ ngày']
                    : [formatCompact(v), 'Tổng']
                }
              />
              <Line
                type="monotone"
                dataKey="subscribers"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              {data.milestones.map((m) => (
                <ReferenceDot
                  key={m.date}
                  x={m.date}
                  y={m.value}
                  r={6}
                  fill="#f59e0b"
                  stroke="#fff"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                  label={{
                    value: m.label,
                    position: 'top',
                    fontSize: 10,
                    fill: '#f59e0b',
                  }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {data.milestones.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              🏆 {data.milestones.length} milestone đạt được trong kỳ
            </p>
          )}
        </CardContent>
      </Card>

      {/* Revenue (YouTube only) */}
      {isYouTube && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Doanh thu hàng ngày</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={revData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="name"
                  tickFormatter={(d: string) => format(parseISO(d), 'dd/MM')}
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  className="text-muted-foreground"
                  minTickGap={20}
                />
                <YAxis
                  tickFormatter={(v: number) => formatUsd(v)}
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
                  labelFormatter={(d: string) => format(parseISO(d), 'dd/MM/yyyy')}
                  formatter={(v: number) => [formatUsd(v), 'Revenue']}
                />
                <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
