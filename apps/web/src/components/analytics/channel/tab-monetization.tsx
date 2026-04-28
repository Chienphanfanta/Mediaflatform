'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatCompact, formatHours, formatPct, formatUsd } from '@/lib/format';
import type {
  MonetizationData,
  MonetizationStatus,
  ViolationItem,
} from '@/lib/types/channel-detail';

type Props = {
  data?: MonetizationData | null;
  isLoading: boolean;
  channelPlatform?: string;
};

const STATUS: Record<
  MonetizationStatus,
  { label: string; color: string; Icon: typeof CheckCircle2 }
> = {
  APPROVED: {
    label: 'Đã được duyệt monetization',
    color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    Icon: ShieldCheck,
  },
  UNDER_REVIEW: {
    label: 'Đủ điều kiện — đang chờ YouTube duyệt',
    color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
    Icon: Clock,
  },
  NOT_MONETIZED: {
    label: 'Chưa đạt điều kiện monetization',
    color: 'bg-muted text-muted-foreground border',
    Icon: XCircle,
  },
  DEMONETIZED: {
    label: 'Đã bị tắt monetization',
    color: 'bg-destructive/10 text-destructive border-destructive/30',
    Icon: AlertTriangle,
  },
};

export function TabMonetization({ data, isLoading, channelPlatform }: Props) {
  if (channelPlatform !== 'YOUTUBE') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <ShieldCheck className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">Monetization chỉ áp dụng cho YouTube</p>
          <p className="text-xs text-muted-foreground">
            Kênh này thuộc nền tảng khác — không có dashboard monetization.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  const s = STATUS[data.status];
  const monthlyChart = data.monthlyRevenue.labels.map((label, i) => ({
    name: label,
    revenue: data.monthlyRevenue.data[i],
  }));

  return (
    <div className="space-y-4">
      {/* Status badge */}
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full',
              s.color,
            )}
          >
            <s.Icon className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Trạng thái</p>
            <p className={cn('text-sm font-medium')}>{s.label}</p>
          </div>
          <Badge variant="outline" className={cn('border', s.color)}>
            {data.status}
          </Badge>
        </CardContent>
      </Card>

      {/* Progress 4000h + 1000 subs */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProgressCard
          icon={Clock}
          title="Watch Time / 4,000h"
          value={formatHours(data.watchTimeYearlyHours)}
          target={`${formatHours(data.watchTimeThreshold)}`}
          progressPct={data.watchTimeProgressPct}
          hint={`Ước tính cả năm theo tốc độ hiện tại · ${formatPct(data.watchTimeProgressPct, { signed: false })}`}
        />
        <ProgressCard
          icon={Users}
          title="Subscribers / 1,000"
          value={formatCompact(data.subscribersCount)}
          target={formatCompact(data.subscribersThreshold)}
          progressPct={data.subscribersProgressPct}
          hint={`${formatPct(data.subscribersProgressPct, { signed: false })} đến ngưỡng`}
        />
      </div>

      {/* Violations history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Lịch sử vi phạm
            {data.violations.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({data.violations.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.violations.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              ✅ Không có vi phạm nào được ghi nhận.
            </p>
          ) : (
            <ul className="divide-y">
              {data.violations.map((v) => (
                <ViolationRow key={v.id} violation={v} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Monthly revenue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Doanh thu 6 tháng</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyChart} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="name"
                tickFormatter={(d: string) => format(parseISO(d + '-01'), 'MM/yyyy')}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
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
                labelFormatter={(d: string) =>
                  format(parseISO(d + '-01'), 'MMMM yyyy', { locale: vi })
                }
                formatter={(v: number) => [formatUsd(v), 'Revenue']}
              />
              <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function ProgressCard({
  icon: Icon,
  title,
  value,
  target,
  progressPct,
  hint,
}: {
  icon: typeof Clock;
  title: string;
  value: string;
  target: string;
  progressPct: number;
  hint: string;
}) {
  const pct = Math.min(100, Math.max(0, progressPct));
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon className="h-4 w-4" />
            {title}
          </span>
          <span className="text-xs text-muted-foreground">/ {target}</span>
        </div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full transition-all',
              pct >= 100 ? 'bg-emerald-500' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function ViolationRow({ violation: v }: { violation: ViolationItem }) {
  const sev = {
    LOW: 'bg-muted text-muted-foreground border-muted',
    MEDIUM: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    HIGH: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
    CRITICAL: 'bg-destructive/10 text-destructive border-destructive/30',
  }[v.severity];

  return (
    <li className="flex items-start gap-3 py-3">
      <AlertTriangle
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          v.severity === 'CRITICAL' ? 'text-destructive' : 'text-amber-500',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium">{v.message}</p>
          <Badge variant="outline" className={cn('shrink-0 border text-[10px]', sev)}>
            {v.severity}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {format(parseISO(v.createdAt), 'dd/MM/yyyy HH:mm')}
        </p>
      </div>
    </li>
  );
}
