// /kpi — KPI Overview với period selector + view toggle (employee/channel) +
// status filter + grid cards.
// Note: Department filter skipped (Department model chưa có).
'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertCircle,
  LayoutGrid,
  Plus,
  Radio,
  Target,
  Users,
} from 'lucide-react';
import type { KPIStatus } from '@prisma/client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { KPIProgressBar } from '@/components/kpi/kpi-progress-bar';
import { useKpis } from '@/hooks/use-kpi';
import { usePermission } from '@/hooks/use-permission';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { KpiWithRelations } from '@/lib/types/kpi';

type PeriodMode = 'monthly' | 'quarterly' | 'yearly' | 'custom';
type ViewMode = 'employee' | 'channel';

const STATUS_OPTIONS: Array<{ value: KPIStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'IN_PROGRESS', label: 'Đang chạy' },
  { value: 'ACHIEVED', label: 'Đạt' },
  { value: 'EXCEEDED', label: 'Vượt mức' },
  { value: 'MISSED', label: 'Không đạt' },
];

const PERIOD_OPTIONS: Array<{ value: PeriodMode; label: string }> = [
  { value: 'monthly', label: 'Tháng này' },
  { value: 'quarterly', label: 'Quý này' },
  { value: 'yearly', label: 'Năm này' },
];

/** Compute "active on" date — current period dùng để filter KPIs active. */
function activeOnFor(mode: PeriodMode): string {
  // Đơn giản hoá: dùng now (mọi mode đều ở now). Khi schema cho phép custom
  // period filter sâu hơn (vd "month=2026-04") sẽ pass theo periodType.
  return new Date().toISOString().slice(0, 10);
}

export default function KpiPage() {
  const { atLeast } = usePermission();
  const canManage = atLeast('MANAGER');

  const [periodMode, setPeriodMode] = useState<PeriodMode>('monthly');
  const [viewMode, setViewMode] = useState<ViewMode>('employee');
  const [statusFilter, setStatusFilter] = useState<KPIStatus | 'all'>('all');

  const activeOn = activeOnFor(periodMode);

  const { data, isLoading, isError, error } = useKpis({
    activeOn,
    status: statusFilter === 'all' ? undefined : statusFilter,
    periodType:
      periodMode === 'monthly'
        ? 'MONTHLY'
        : periodMode === 'quarterly'
          ? 'QUARTERLY'
          : periodMode === 'yearly'
            ? 'YEARLY'
            : undefined,
  });

  const kpis = data?.items ?? [];

  // Group KPIs by employee or channel
  const groupedByEmployee = useMemo(
    () => groupByEmployee(kpis),
    [kpis],
  );
  const groupedByChannel = useMemo(
    () => groupByChannel(kpis),
    [kpis],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Target className="h-7 w-7" />
            KPI Overview
            {data && (
              <span className="text-sm font-normal text-muted-foreground">
                ({data.total} KPI)
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tổng hợp KPI active theo period — theo nhân viên hoặc theo kênh.
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/kpi/assign">
              <Plus className="h-4 w-4" />
              Giao KPI mới
            </Link>
          </Button>
        )}
      </header>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          {/* Period selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Period:
            </span>
            {PERIOD_OPTIONS.map((p) => (
              <Pill
                key={p.value}
                active={periodMode === p.value}
                onClick={() => setPeriodMode(p.value)}
              >
                {p.label}
              </Pill>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Status:
            </span>
            {STATUS_OPTIONS.map((s) => (
              <Pill
                key={s.value}
                active={statusFilter === s.value}
                onClick={() => setStatusFilter(s.value)}
              >
                {s.label}
              </Pill>
            ))}
          </div>

          {/* View toggle */}
          <div className="ml-auto flex rounded-md border bg-background">
            <Button
              type="button"
              variant={viewMode === 'employee' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 rounded-r-none border-r"
              onClick={() => setViewMode('employee')}
            >
              <Users className="h-4 w-4" />
              Nhân viên
            </Button>
            <Button
              type="button"
              variant={viewMode === 'channel' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 rounded-l-none"
              onClick={() => setViewMode('channel')}
            >
              <Radio className="h-4 w-4" />
              Kênh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được KPI</AlertTitle>
          <AlertDescription>
            {error?.message ?? 'Lỗi không xác định.'}
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : kpis.length === 0 ? (
        <EmptyState canManage={canManage} />
      ) : viewMode === 'employee' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groupedByEmployee.map((g) => (
            <EmployeeKpiCard key={g.employeeId} group={g} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groupedByChannel.map((g) => (
            <ChannelKpiCard key={g.channelId} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────── Grouping ──────────

type EmployeeGroup = {
  employeeId: string;
  name: string;
  email: string;
  avatar: string | null;
  channelCount: number;
  averageAchievement: number | null;
  topKpis: KpiWithRelations[];
};

function groupByEmployee(kpis: KpiWithRelations[]): EmployeeGroup[] {
  const map = new Map<string, KpiWithRelations[]>();
  for (const kpi of kpis) {
    const arr = map.get(kpi.employeeId) ?? [];
    arr.push(kpi);
    map.set(kpi.employeeId, arr);
  }
  return Array.from(map.entries())
    .map(([employeeId, list]) => {
      const e = list[0].employee;
      const channelIds = new Set(
        list.filter((k) => k.channelId).map((k) => k.channelId!),
      );
      const withPercent = list.filter((k) => k.achievementPercent != null);
      const avg =
        withPercent.length > 0
          ? withPercent.reduce((s, k) => s + (k.achievementPercent ?? 0), 0) /
            withPercent.length
          : null;
      const top = [...list]
        .sort(
          (a, b) =>
            (b.achievementPercent ?? -Infinity) -
            (a.achievementPercent ?? -Infinity),
        )
        .slice(0, 3);
      return {
        employeeId,
        name: e.name,
        email: e.email,
        avatar: e.avatar,
        channelCount: channelIds.size,
        averageAchievement: avg,
        topKpis: top,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

type ChannelGroup = {
  channelId: string;
  name: string;
  platform: KpiWithRelations['channel'] extends infer C
    ? C extends { platform: infer P }
      ? P
      : never
    : never;
  averageAchievement: number | null;
  ownerCount: number;
  topKpis: KpiWithRelations[];
};

function groupByChannel(kpis: KpiWithRelations[]): ChannelGroup[] {
  const map = new Map<string, KpiWithRelations[]>();
  for (const kpi of kpis) {
    if (!kpi.channelId || !kpi.channel) continue; // skip PER_EMPLOYEE
    const arr = map.get(kpi.channelId) ?? [];
    arr.push(kpi);
    map.set(kpi.channelId, arr);
  }
  return Array.from(map.entries())
    .map(([channelId, list]) => {
      const c = list[0].channel!;
      const ownerIds = new Set(list.map((k) => k.employeeId));
      const withPercent = list.filter((k) => k.achievementPercent != null);
      const avg =
        withPercent.length > 0
          ? withPercent.reduce((s, k) => s + (k.achievementPercent ?? 0), 0) /
            withPercent.length
          : null;
      const top = [...list]
        .sort(
          (a, b) =>
            (b.achievementPercent ?? -Infinity) -
            (a.achievementPercent ?? -Infinity),
        )
        .slice(0, 3);
      return {
        channelId,
        name: c.name,
        platform: c.platform,
        averageAchievement: avg,
        ownerCount: ownerIds.size,
        topKpis: top,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ────────── Cards ──────────

function EmployeeKpiCard({ group }: { group: EmployeeGroup }) {
  return (
    <Link href={`/kpi/employee/${group.employeeId}`}>
      <Card className="group h-full transition-colors hover:border-primary/40">
        <CardContent className="space-y-3 p-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={group.avatar ?? undefined} />
              <AvatarFallback>
                {group.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold group-hover:underline">
                {group.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {group.channelCount} kênh phụ trách · {group.topKpis.length}+ KPI
              </div>
            </div>
          </div>

          {/* Aggregate progress */}
          <KPIProgressBar
            percent={group.averageAchievement}
            label="Trung bình achievement"
          />

          {/* Top 3 KPIs (mini) */}
          {group.topKpis.length > 0 && (
            <div className="space-y-1.5 border-t pt-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Top {group.topKpis.length} KPI
              </p>
              {group.topKpis.map((kpi) => (
                <KPIProgressBar
                  key={kpi.id}
                  percent={kpi.achievementPercent}
                  compact
                  label={
                    kpi.scope === 'PER_CHANNEL' && kpi.channel
                      ? kpi.channel.name
                      : 'Cross-channel'
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function ChannelKpiCard({ group }: { group: ChannelGroup }) {
  return (
    <Link href={`/channels/${group.channelId}?tab=kpi`}>
      <Card className="group h-full transition-colors hover:border-primary/40">
        <CardContent className="space-y-3 p-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white',
                PLATFORM_DOT[group.platform as keyof typeof PLATFORM_DOT],
              )}
            >
              {String(group.platform)[0]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold group-hover:underline">
                {group.name}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">
                  {PLATFORM_LABEL[group.platform as keyof typeof PLATFORM_LABEL]}
                </Badge>
                · {group.ownerCount} owner · {group.topKpis.length} KPI
              </div>
            </div>
          </div>

          {/* Aggregate progress */}
          <KPIProgressBar
            percent={group.averageAchievement}
            label="Trung bình achievement"
          />

          {/* Top 3 KPIs (mini) */}
          {group.topKpis.length > 0 && (
            <div className="space-y-1.5 border-t pt-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Top {group.topKpis.length} KPI
              </p>
              {group.topKpis.map((kpi) => (
                <KPIProgressBar
                  key={kpi.id}
                  percent={kpi.achievementPercent}
                  compact
                  label={kpi.employee.name}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyState({ canManage }: { canManage: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
        <LayoutGrid className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium">Không có KPI nào trong period này</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {canManage
            ? 'Đổi period filter hoặc giao KPI đầu tiên.'
            : 'Liên hệ Manager để giao KPI.'}
        </p>
        {canManage && (
          <Button asChild className="mt-2">
            <Link href="/kpi/assign">
              <Plus className="h-4 w-4" />
              Giao KPI mới
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
