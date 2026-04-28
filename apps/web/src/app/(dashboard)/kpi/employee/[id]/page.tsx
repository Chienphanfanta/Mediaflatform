// /kpi/employee/[id] — KPI-focused detail của 1 nhân viên.
// Khác /employees/[id] (profile-focused): trang này focus historical KPIs,
// trends, chi tiết per-period.
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { differenceInCalendarDays, format } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Mail,
  Plus,
  Target,
  UserX,
} from 'lucide-react';
import type { KPIStatus } from '@prisma/client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { KPIProgressBar } from '@/components/kpi/kpi-progress-bar';
import { useKpis, useKpiSummaryEmployee } from '@/hooks/use-kpi';
import { usePermission } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import type { KpiWithRelations } from '@/lib/types/kpi';

const STATUS_BADGE: Record<KPIStatus, string> = {
  NOT_STARTED: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  IN_PROGRESS: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  ACHIEVED:
    'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  EXCEEDED:
    'border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300',
  MISSED: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const STATUS_LABEL: Record<KPIStatus, string> = {
  NOT_STARTED: 'Chưa bắt đầu',
  IN_PROGRESS: 'Đang chạy',
  ACHIEVED: 'Đạt',
  EXCEEDED: 'Vượt mức',
  MISSED: 'Không đạt',
};

export default function KpiEmployeePage() {
  const params = useParams<{ id: string }>();
  const employeeId = params?.id ?? '';

  const { atLeast } = usePermission();
  const canManage = atLeast('MANAGER');

  // Active KPIs (period contains now)
  const summary = useKpiSummaryEmployee(employeeId);

  // All KPIs ever (no activeOn) — for historical filter client-side
  const all = useKpis({ employeeId });

  if (summary.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Không tải được KPI</AlertTitle>
        <AlertDescription>
          {summary.error?.message ?? 'Lỗi không xác định.'}
        </AlertDescription>
      </Alert>
    );
  }

  if (summary.isLoading || !summary.data) {
    return <PageSkeleton />;
  }

  const employee = summary.data.employee;
  const activeKpis = summary.data.kpis;

  // Historical = KPIs có periodEnd < now
  const now = new Date();
  const historicalKpis = (all.data?.items ?? []).filter(
    (k) => new Date(k.periodEnd) < now,
  );

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/kpi">
          <ArrowLeft className="h-4 w-4" />
          Quay lại KPI Overview
        </Link>
      </Button>

      {/* Header */}
      <Card>
        <CardContent className="flex flex-wrap items-start gap-4 p-5">
          <Avatar className="h-16 w-16">
            <AvatarImage src={employee.avatar ?? undefined} />
            <AvatarFallback className="text-lg">
              {employee.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {employee.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                {employee.email}
              </span>
              {/* Department placeholder — Sprint 9 */}
              <span className="inline-flex items-center gap-1 text-muted-foreground/60">
                <Building2 className="h-3.5 w-3.5" />
                Phòng ban (Sprint 9)
              </span>
            </div>

            {/* Aggregate */}
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Stat
                label="Active KPIs"
                value={String(summary.data.totals.totalKpis)}
              />
              <Stat
                label="TB Achievement"
                value={
                  summary.data.totals.avgAchievement !== null
                    ? `${summary.data.totals.avgAchievement.toFixed(1)}%`
                    : '—'
                }
              />
              <Stat
                label="Lịch sử"
                value={String(historicalKpis.length)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/employees/${employeeId}`}>
                Xem profile →
              </Link>
            </Button>
            {canManage && (
              <Button asChild size="sm">
                <Link href={`/kpi/assign`}>
                  <Plus className="h-4 w-4" />
                  Giao KPI mới
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active KPIs — full per-target breakdown */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Target className="h-5 w-5" />
          KPIs đang active ({activeKpis.length})
        </h2>
        {activeKpis.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm font-medium">Không có KPI active</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {canManage
                  ? 'Giao KPI để theo dõi performance.'
                  : 'Manager chưa giao KPI cho period hiện tại.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {activeKpis.map((kpi) => (
              <ActiveKpiCard key={kpi.id} kpi={kpi} now={now} />
            ))}
          </div>
        )}
      </section>

      {/* Historical KPIs — table view */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Lịch sử KPIs</h2>
        {all.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : historicalKpis.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-xs text-muted-foreground">
              Chưa có KPI period đã kết thúc.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Period</th>
                      <th className="px-4 py-2 font-medium">Scope</th>
                      <th className="px-4 py-2 font-medium">Subject</th>
                      <th className="px-4 py-2 text-right font-medium">
                        Achievement
                      </th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {historicalKpis.map((kpi) => (
                      <HistoricalRow key={kpi.id} kpi={kpi} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function ActiveKpiCard({
  kpi,
  now,
}: {
  kpi: KpiWithRelations;
  now: Date;
}) {
  const daysRemaining = differenceInCalendarDays(new Date(kpi.periodEnd), now);
  const subject =
    kpi.scope === 'PER_CHANNEL' && kpi.channel
      ? kpi.channel.name
      : 'Cross-channel';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">
              {kpi.periodType === 'MONTHLY'
                ? 'Tháng'
                : kpi.periodType === 'QUARTERLY'
                  ? 'Quý'
                  : 'Năm'}{' '}
              {format(new Date(kpi.periodStart), 'MM/yyyy', { locale: vi })}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {kpi.scope === 'PER_CHANNEL' ? 'Kênh: ' : 'Cross-channel: '}
              <span className="font-medium">{subject}</span>
            </p>
          </div>
          <div className="text-right">
            <Badge
              variant="outline"
              className={cn('text-[10px]', STATUS_BADGE[kpi.status])}
            >
              {STATUS_LABEL[kpi.status]}
            </Badge>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Còn {daysRemaining > 0 ? `${daysRemaining} ngày` : 'kết thúc'}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Aggregate */}
        <KPIProgressBar
          percent={kpi.achievementPercent}
          label="Trung bình achievement"
        />

        {/* Per-target breakdown — chỉ hiển thị targets có set */}
        <div className="space-y-2 rounded-md bg-muted/30 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Targets vs Actual
          </p>
          <TargetRowsTable kpi={kpi} />
        </div>

        {kpi.notes && (
          <p className="border-t pt-2 text-[11px] italic text-muted-foreground">
            {kpi.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Table per-target. Note Day 8 Option B: chỉ có target value (KPI table không
 * persist actuals per target — chỉ averagePercent). Hiển thị target only;
 * actual + per-target % sẽ hiện sau khi user trigger recalc qua KpiCard menu.
 */
function TargetRowsTable({ kpi }: { kpi: KpiWithRelations }) {
  const rows: Array<{ label: string; target: number | null; format: (n: number) => string }> = [
    { label: 'Followers', target: kpi.targetFollowers, format: (n: number) => n.toLocaleString() },
    { label: 'Δ Followers', target: kpi.targetFollowersGain, format: (n: number) => n.toLocaleString() },
    { label: 'Views', target: kpi.targetViews, format: (n: number) => n.toLocaleString() },
    { label: 'Watch time (h)', target: kpi.targetWatchTime, format: (n: number) => n.toLocaleString() },
    { label: 'Engagement (%)', target: kpi.targetEngagement, format: (n: number) => n.toFixed(1) },
  ].filter((r) => r.target !== null);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">— Không target nào set —</p>
    );
  }

  return (
    <table className="w-full text-xs">
      <tbody className="divide-y">
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="py-1.5 text-muted-foreground">{r.label}</td>
            <td className="py-1.5 text-right tabular-nums">
              Target: <span className="font-medium">{r.format(r.target!)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoricalRow({ kpi }: { kpi: KpiWithRelations }) {
  const subject =
    kpi.scope === 'PER_CHANNEL' && kpi.channel
      ? kpi.channel.name
      : 'Cross-channel';

  return (
    <tr className="transition-colors hover:bg-accent/30">
      <td className="px-4 py-2.5 text-xs">
        {format(new Date(kpi.periodStart), 'dd/MM/yyyy', { locale: vi })}
        <span className="mx-1 text-muted-foreground">→</span>
        {format(new Date(kpi.periodEnd), 'dd/MM/yyyy', { locale: vi })}
      </td>
      <td className="px-4 py-2.5">
        <Badge variant="outline" className="text-[10px]">
          {kpi.scope === 'PER_CHANNEL' ? 'Kênh' : 'Cross'}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-xs">{subject}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-xs">
        {kpi.achievementPercent !== null
          ? `${kpi.achievementPercent.toFixed(1)}%`
          : '—'}
      </td>
      <td className="px-4 py-2.5">
        <Badge
          variant="outline"
          className={cn('text-[10px]', STATUS_BADGE[kpi.status])}
        >
          {STATUS_LABEL[kpi.status]}
        </Badge>
      </td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

// Suppress unused import warning for UserX (used in future not-found state)
void UserX;
