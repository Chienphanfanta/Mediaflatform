'use client';

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Platform } from '@prisma/client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { formatCompact, formatHours, formatPct } from '@/lib/format';
import { PLATFORM_LABEL } from '@/lib/platform';
import type { PlatformBreakdownItem } from '@/lib/types/analytics-summary';

type Props = {
  data?: PlatformBreakdownItem[];
  isLoading: boolean;
};

const COLORS: Record<Platform, string> = {
  YOUTUBE: '#FF0000',
  FACEBOOK: '#1877F2',
  INSTAGRAM: '#E1306C',
  X: '#0F172A',
  TELEGRAM: '#8B5CF6',
  WHATSAPP: '#25D366',
};

export function PlatformBreakdown({ data, isLoading }: Props) {
  const isMobile = useMobile();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Phân tích theo nền tảng</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[260px] w-full" />
            <Skeleton className="h-[260px] w-full" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            Chưa có dữ liệu.
          </div>
        ) : isMobile ? (
          // Mobile: horizontal bar chart (dễ đọc hơn donut nhỏ) + scroll table
          <div className="space-y-4">
            <HorizontalBars data={data} />
            <BreakdownTable data={data} mobile />
          </div>
        ) : (
          // Tablet+: donut + table side-by-side
          <div className="grid gap-6 lg:grid-cols-2">
            <Donut data={data} />
            <BreakdownTable data={data} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ────────── Donut (desktop) ──────────

function Donut({ data }: { data: PlatformBreakdownItem[] }) {
  const chartData = data.map((d) => ({
    name: d.platform,
    value: d.views,
    share: d.viewsSharePct,
  }));

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
            stroke="hsl(var(--background))"
            strokeWidth={2}
          >
            {chartData.map((d) => (
              <Cell key={d.name} fill={COLORS[d.name as Platform]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: number, _n, p) => [
              `${formatCompact(v)} (${formatPct((p.payload as { share: number }).share, { signed: false })})`,
              PLATFORM_LABEL[(p.payload as { name: Platform }).name] ?? p.payload?.name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Tổng views
        </span>
        <span className="text-2xl font-bold">
          {formatCompact(data.reduce((s, d) => s + d.views, 0))}
        </span>
      </div>
    </div>
  );
}

// ────────── Horizontal bars (mobile) ──────────
//
// Bar chart ngang dễ đọc hơn donut nhỏ trên mobile — label rõ, value đối xứng,
// không cần tooltip để compare. YAxis label = tên platform đầy đủ.

function HorizontalBars({ data }: { data: PlatformBreakdownItem[] }) {
  const chartData = data.map((d) => ({
    name: PLATFORM_LABEL[d.platform],
    platform: d.platform,
    views: d.views,
    share: d.viewsSharePct,
  }));
  // Height proportional to # platforms (40px per row + 20px padding)
  const height = Math.max(160, chartData.length * 44 + 16);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
      >
        <XAxis type="number" hide />
        <YAxis
          dataKey="name"
          type="category"
          width={88}
          tick={{ fontSize: 12 }}
          stroke="currentColor"
          className="text-muted-foreground"
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 10,
            fontSize: 14,
            padding: '10px 14px',
          }}
          formatter={(v: number, _n, p) => [
            `${formatCompact(v)} (${formatPct((p.payload as { share: number }).share, { signed: false })})`,
            'Views',
          ]}
        />
        <Bar dataKey="views" radius={[0, 4, 4, 0]}>
          {chartData.map((d) => (
            <Cell key={d.platform} fill={COLORS[d.platform]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ────────── Breakdown table ──────────

function BreakdownTable({
  data,
  mobile,
}: {
  data: PlatformBreakdownItem[];
  mobile?: boolean;
}) {
  return (
    // Mobile: horizontal scroll cho columns đông
    <div className={cn('rounded-lg border', mobile && 'overflow-x-auto')}>
      <table className={cn('w-full text-sm', mobile && 'min-w-[480px]')}>
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Platform</th>
            <th className="px-3 py-2 text-right font-medium">Views</th>
            <th className="px-3 py-2 text-right font-medium">Watch</th>
            <th className="px-3 py-2 text-right font-medium">Eng.</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((d) => (
            <tr key={d.platform} className="transition-colors hover:bg-accent/50">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn('h-2.5 w-2.5 rounded-sm')}
                    style={{ backgroundColor: COLORS[d.platform] }}
                  />
                  <span className="font-medium">{PLATFORM_LABEL[d.platform]}</span>
                </div>
                <span className="ml-4.5 text-[10px] text-muted-foreground">
                  {formatPct(d.viewsSharePct, { signed: false })}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCompact(d.views)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatHours(d.watchTimeHours)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {d.avgEngagement.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
