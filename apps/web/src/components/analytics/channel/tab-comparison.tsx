'use client';

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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  formatCompact,
  formatHours,
  formatPct,
  formatUsd,
} from '@/lib/format';
import type { ComparisonData } from '@/lib/types/channel-detail';

type Props = {
  data?: ComparisonData;
  isLoading: boolean;
};

function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

export function TabComparison({ data, isLoading }: Props) {
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[320px] w-full rounded-lg" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg lg:col-span-2" />
        </div>
      </div>
    );
  }

  // Build overlay chart data — both periods aligned trên trục Day 1, Day 2,...
  const chartData = data.current.daily.map((cur, i) => ({
    name: `D${i + 1}`,
    current: cur,
    previous: data.previous.daily[i] ?? 0,
  }));

  const periodLabel =
    data.period === '7d' ? '7 ngày' : data.period === '30d' ? '30 ngày' : '90 ngày';

  return (
    <div className="space-y-4">
      {/* Overlay chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Views — kỳ này vs kỳ trước</CardTitle>
          <p className="text-xs text-muted-foreground">
            {periodLabel} hiện tại ({data.current.from} → {data.current.to}) so với
            kỳ trước ({data.previous.from} → {data.previous.to})
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
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
                formatter={(v: number, name: string) => [
                  formatCompact(v),
                  name === 'current' ? 'Kỳ này' : 'Kỳ trước',
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(v) => (v === 'current' ? 'Kỳ này' : 'Kỳ trước')}
              />
              <Line
                type="monotone"
                dataKey="previous"
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="current"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Score + summary table */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ScoreCard score={data.score} />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Tóm tắt so sánh</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Metric</th>
                    <th className="pb-2 text-right font-medium">Kỳ trước</th>
                    <th className="pb-2 text-right font-medium">Kỳ này</th>
                    <th className="pb-2 text-right font-medium">Δ %</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <Row
                    label="Views"
                    cur={data.current.totalViews}
                    prev={data.previous.totalViews}
                    fmt={formatCompact}
                  />
                  <Row
                    label="Subscribers tăng"
                    cur={data.current.totalSubscribers}
                    prev={data.previous.totalSubscribers}
                    fmt={formatCompact}
                  />
                  <Row
                    label="Revenue"
                    cur={data.current.totalRevenue}
                    prev={data.previous.totalRevenue}
                    fmt={formatUsd}
                  />
                  <Row
                    label="Engagement"
                    cur={data.current.avgEngagement}
                    prev={data.previous.avgEngagement}
                    fmt={(v) => `${v.toFixed(2)}%`}
                  />
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label,
  cur,
  prev,
  fmt,
}: {
  label: string;
  cur: number;
  prev: number;
  fmt: (n: number) => string;
}) {
  const dp = deltaPct(cur, prev);
  const up = typeof dp === 'number' && dp > 0;
  const down = typeof dp === 'number' && dp < 0;
  return (
    <tr className="hover:bg-accent/30">
      <td className="py-2.5 font-medium">{label}</td>
      <td className="py-2.5 text-right tabular-nums text-muted-foreground">
        {fmt(prev)}
      </td>
      <td className="py-2.5 text-right tabular-nums">{fmt(cur)}</td>
      <td
        className={cn(
          'py-2.5 text-right tabular-nums font-medium',
          up && 'text-emerald-600 dark:text-emerald-400',
          down && 'text-destructive',
          !up && !down && 'text-muted-foreground',
        )}
      >
        {formatPct(dp)}
      </td>
    </tr>
  );
}

function ScoreCard({ score }: { score: ComparisonData['score'] }) {
  const total = score.total;
  const grade =
    total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : total >= 20 ? 'D' : 'F';
  const gradeColor =
    total >= 60
      ? 'text-emerald-500'
      : total >= 40
        ? 'text-amber-500'
        : 'text-destructive';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Performance Score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-center gap-4">
          <div className="text-center">
            <div className={cn('text-5xl font-bold tracking-tight', gradeColor)}>
              {total}
            </div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              / 100
            </div>
          </div>
          <div className={cn('text-6xl font-extrabold leading-none', gradeColor)}>
            {grade}
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <ScoreBar
            label="Tăng trưởng"
            value={score.breakdown.growth}
            max={score.max.growth}
            color="bg-emerald-500"
          />
          <ScoreBar
            label="Engagement"
            value={score.breakdown.engagement}
            max={score.max.engagement}
            color="bg-blue-500"
          />
          <ScoreBar
            label="Đều đặn"
            value={score.breakdown.consistency}
            max={score.max.consistency}
            color="bg-violet-500"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value} / {max}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
