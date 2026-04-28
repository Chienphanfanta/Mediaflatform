// /employees/[id] — Per-Employee Dashboard với sticky header + 4 tabs.
// Day 9: full rewrite per spec.
// Skip: Recent activity timeline (no audit log), Send Message, Reset Password,
// per-channel mini charts (complex aggregation), compare last month (extra query).
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Calendar,
  Crown,
  ExternalLink,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  PowerOff,
  RefreshCw,
  Target,
  Tv,
  UserX,
} from 'lucide-react';
import type { UserStatus } from '@prisma/client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreateKpiDialog } from '@/components/kpi/create-kpi-dialog';
import { KpiCard } from '@/components/kpi/kpi-card';
import { KPIProgressBar } from '@/components/kpi/kpi-progress-bar';
import { EditEmployeeDialog } from '@/components/employees/edit-employee-dialog';
import { apiFetch } from '@/lib/api-client';
import { useDeactivateUser } from '@/hooks/use-users';
import { useKpiSummaryEmployee, useKpis } from '@/hooks/use-kpi';
import { usePermission } from '@/hooks/use-permission';
import { formatCompact } from '@/lib/format';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { HRUserDetail } from '@/lib/types/hr';

const STATUS_BADGE: Record<UserStatus, string> = {
  ACTIVE:
    'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  SUSPENDED: 'border-destructive/40 bg-destructive/10 text-destructive',
  INVITED:
    'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
};

class HRFetchError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'HRFetchError';
  }
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<
    HRUserDetail,
    HRFetchError
  >({
    queryKey: ['hr-user', id],
    queryFn: async () => {
      const r = await fetch(`/api/v1/users/${id}`);
      const j = await r.json();
      if (!j.success) {
        throw new HRFetchError(
          j.error?.message ?? 'Lỗi tải nhân sự',
          r.status,
          j.error?.code,
        );
      }
      return j.data;
    },
    retry: (failureCount, err) => {
      if (err instanceof HRFetchError && err.status === 404) return false;
      return failureCount < 2;
    },
  });

  const isNotFound = error instanceof HRFetchError && error.status === 404;

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/employees">
          <ArrowLeft className="h-4 w-4" />
          Quay lại danh sách nhân sự
        </Link>
      </Button>

      {isNotFound ? (
        <NotFoundState />
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được nhân sự</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message ?? 'Lỗi không xác định.'}
            <Button
              size="sm"
              variant="outline"
              className="ml-2"
              onClick={() => refetch()}
            >
              Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      ) : isLoading || !data ? (
        <PageSkeleton />
      ) : (
        <>
          <StickyHeader detail={data} onEdit={() => setEditOpen(true)} />

          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview">Tổng quan</TabsTrigger>
              <TabsTrigger value="channels">
                Kênh ({data.ownedChannels.length})
              </TabsTrigger>
              <TabsTrigger value="kpi">KPI</TabsTrigger>
              <TabsTrigger value="analytics">Tăng trưởng</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <OverviewTab detail={data} />
            </TabsContent>

            <TabsContent value="channels">
              <ChannelsTab detail={data} />
            </TabsContent>

            <TabsContent value="kpi">
              <KpiTab employeeId={data.id} />
            </TabsContent>

            <TabsContent value="analytics">
              <AnalyticsTab detail={data} />
            </TabsContent>
          </Tabs>

          {editOpen && (
            <EditEmployeeDialog
              user={data}
              open={editOpen}
              onClose={() => setEditOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ────────── Sticky Header ──────────

function StickyHeader({
  detail,
  onEdit,
}: {
  detail: HRUserDetail;
  onEdit: () => void;
}) {
  const { atLeast, user: currentUser } = usePermission();
  const canManage = atLeast('GROUP_ADMIN');
  const isSelf = currentUser?.id === detail.id;

  const deactivate = useDeactivateUser();
  const kpiSummary = useKpiSummaryEmployee(detail.id);
  const kpiCount = kpiSummary.data?.totals.totalKpis ?? 0;

  const handleDeactivate = () => {
    if (!confirm(`Deactivate ${detail.name}? Status sẽ chuyển sang SUSPENDED.`))
      return;
    deactivate.mutate(detail.id);
  };

  return (
    <Card className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-card/95">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={detail.avatar ?? undefined} />
            <AvatarFallback className="text-lg">
              {detail.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {detail.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {detail.position ?? <span className="italic">Chưa có position</span>}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {detail.department && (
                <Badge
                  variant="secondary"
                  className="text-xs"
                  style={
                    detail.department.color
                      ? {
                          backgroundColor: `${detail.department.color}20`,
                          color: detail.department.color,
                        }
                      : undefined
                  }
                >
                  <Building2 className="mr-1 h-3 w-3" />
                  {detail.department.name}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {detail.primaryRole}
              </Badge>
              <Badge
                variant="outline"
                className={cn('text-xs', STATUS_BADGE[detail.status])}
              >
                {detail.status === 'ACTIVE'
                  ? 'Đang hoạt động'
                  : detail.status === 'SUSPENDED'
                    ? 'Tạm dừng'
                    : 'Đã mời'}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(canManage || isSelf) && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
            {canManage && !isSelf && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  title="Sprint 10+ — cần email infra"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reset Password
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  title="Sprint 10+ — cần messaging module"
                >
                  <MessageSquare className="h-4 w-4" />
                  Message
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeactivate}
                  disabled={deactivate.isPending || detail.status === 'SUSPENDED'}
                  className="text-destructive hover:text-destructive"
                >
                  <PowerOff className="h-4 w-4" />
                  Deactivate
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Mail className="h-3 w-3" />
            {detail.email}
          </span>
          {detail.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {detail.phone}
            </span>
          )}
          {detail.joinDate && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Join {format(new Date(detail.joinDate), 'dd/MM/yyyy', { locale: vi })}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Tv className="h-3 w-3" />
              {detail.ownedChannels.length} kênh
            </span>
            <span className="inline-flex items-center gap-1">
              <Target className="h-3 w-3" />
              {kpiCount} KPI active
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────── Tab 1: Overview ──────────

function OverviewTab({ detail }: { detail: HRUserDetail }) {
  const kpiSummary = useKpiSummaryEmployee(detail.id);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Tv className="h-4 w-4" />
            Channels phụ trách ({detail.ownedChannels.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {detail.ownedChannels.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">
              Chưa được gán kênh nào.
            </p>
          ) : (
            <ul className="divide-y">
              {detail.ownedChannels.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 px-4 py-2.5 transition-colors hover:bg-accent/40"
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white',
                      PLATFORM_DOT[c.platform],
                    )}
                  >
                    {PLATFORM_LABEL[c.platform][0]}
                  </span>
                  <Link
                    href={`/channels/${c.id}`}
                    className="min-w-0 flex-1 text-sm hover:underline"
                  >
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {PLATFORM_LABEL[c.platform]}
                    </div>
                  </Link>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      c.role === 'PRIMARY' &&
                        'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {c.role === 'PRIMARY' && (
                      <Crown className="mr-1 h-2.5 w-2.5" />
                    )}
                    {c.role}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" />
            KPI Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {kpiSummary.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !kpiSummary.data || kpiSummary.data.totals.totalKpis === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có KPI active cho period này.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="KPIs active"
                  value={String(kpiSummary.data.totals.totalKpis)}
                />
                <Stat
                  label="TB Achievement"
                  value={
                    kpiSummary.data.totals.avgAchievement !== null
                      ? `${kpiSummary.data.totals.avgAchievement.toFixed(1)}%`
                      : '—'
                  }
                />
              </div>
              <KPIProgressBar
                percent={kpiSummary.data.totals.avgAchievement}
                label="Trung bình"
              />
              <div className="text-[10px] text-muted-foreground">
                {Object.entries(kpiSummary.data.totals.byStatus)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' · ')}
              </div>
            </>
          )}
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href={`/kpi/employee/${detail.id}`}>
              Xem chi tiết KPI →
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs italic text-muted-foreground">
            Sprint 10+: cần audit log table cho activity timeline (login,
            channel updates, KPI changes...).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ────────── Tab 2: Channels ──────────

function ChannelsTab({ detail }: { detail: HRUserDetail }) {
  if (detail.ownedChannels.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Tv className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Chưa được gán kênh nào</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Tenant Admin/Manager có thể gán kênh qua trang `/channels/[id]` →
            Manage owners.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {detail.ownedChannels.map((c) => (
        <Link key={c.id} href={`/channels/${c.id}`}>
          <Card
            className={cn(
              'h-full transition-colors hover:border-primary/50',
              c.role === 'PRIMARY' && 'border-amber-500/40 bg-amber-500/5',
            )}
          >
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white',
                    PLATFORM_DOT[c.platform],
                  )}
                >
                  {PLATFORM_LABEL[c.platform][0]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {PLATFORM_LABEL[c.platform]}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px]',
                    c.role === 'PRIMARY' &&
                      'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                  )}
                >
                  {c.role === 'PRIMARY' && <Crown className="mr-1 h-2.5 w-2.5" />}
                  {c.role}
                </Badge>
              </div>
              <p className="text-[10px] italic text-muted-foreground">
                Mini chart per channel — Sprint 10+.
              </p>
              <div className="flex items-center justify-end">
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

// ────────── Tab 3: KPI ──────────

function KpiTab({ employeeId }: { employeeId: string }) {
  const { atLeast } = usePermission();
  const canManage = atLeast('MANAGER');
  const [createOpen, setCreateOpen] = useState(false);

  const summary = useKpiSummaryEmployee(employeeId);
  const all = useKpis({ employeeId });

  if (summary.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const activeKpis = summary.data?.kpis ?? [];
  const now = new Date();
  const historicalKpis = (all.data?.items ?? []).filter(
    (k) => new Date(k.periodEnd) < now,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          KPIs active ({activeKpis.length})
        </h2>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Target className="h-4 w-4" />
            Giao KPI mới
          </Button>
        )}
      </div>

      {activeKpis.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Không có KPI active cho period hiện tại.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {activeKpis.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} hideContext="employee" />
          ))}
        </div>
      )}

      {historicalKpis.length > 0 && (
        <div className="space-y-2 pt-4">
          <h2 className="text-base font-semibold">
            Lịch sử ({historicalKpis.length})
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Period</th>
                      <th className="px-4 py-2 font-medium">Subject</th>
                      <th className="px-4 py-2 text-right font-medium">
                        Achievement
                      </th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {historicalKpis.map((kpi) => (
                      <tr key={kpi.id}>
                        <td className="px-4 py-2 text-xs">
                          {format(new Date(kpi.periodStart), 'MM/yyyy', {
                            locale: vi,
                          })}{' '}
                          ({kpi.periodType})
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {kpi.scope === 'PER_CHANNEL' && kpi.channel
                            ? kpi.channel.name
                            : 'Cross-channel'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs">
                          {kpi.achievementPercent !== null
                            ? `${kpi.achievementPercent.toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {kpi.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {createOpen && (
        <CreateKpiDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          defaultEmployeeId={employeeId}
        />
      )}
    </div>
  );
}

// ────────── Tab 4: Analytics ──────────

function AnalyticsTab({ detail }: { detail: HRUserDetail }) {
  const channels = detail.ownedChannels;

  const channelMetrics = useQuery({
    queryKey: ['employee-analytics', detail.id, channels.map((c) => c.id)],
    queryFn: async () => {
      const results = await Promise.all(
        channels.map((c) =>
          apiFetch<{
            channel: { id: string; name: string };
            overview: {
              labels: string[];
              views: number[];
              subscribers: number[];
              subscriberDelta: number[];
            };
          }>(`/api/v1/analytics/channels/${c.id}/detail?period=30d`).catch(
            () => null,
          ),
        ),
      );
      return results.filter((r): r is NonNullable<typeof r> => r !== null);
    },
    enabled: channels.length > 0,
    staleTime: 120_000,
  });

  const stats = useMemo(() => {
    if (!channelMetrics.data) return null;
    let totalViews = 0;
    let totalDelta = 0;
    let totalFollowers = 0;
    const byPlatform = new Map<string, { views: number; channelCount: number }>();

    for (let i = 0; i < channelMetrics.data.length; i++) {
      const d = channelMetrics.data[i];
      const ch = channels[i];
      if (!d || !ch) continue;

      const sumViews = d.overview.views.reduce((s, v) => s + v, 0);
      const sumDelta = d.overview.subscriberDelta.reduce((s, v) => s + v, 0);
      const lastFollowers =
        d.overview.subscribers[d.overview.subscribers.length - 1] ?? 0;

      totalViews += sumViews;
      totalDelta += sumDelta;
      totalFollowers += lastFollowers;

      const cur = byPlatform.get(ch.platform) ?? { views: 0, channelCount: 0 };
      cur.views += sumViews;
      cur.channelCount += 1;
      byPlatform.set(ch.platform, cur);
    }

    const channelPerf = channelMetrics.data
      .map((d, i) => ({
        name: d.channel.name,
        platform: channels[i]?.platform ?? 'YOUTUBE',
        views: d.overview.views.reduce((s, v) => s + v, 0),
      }))
      .sort((a, b) => b.views - a.views);

    return {
      totalViews,
      totalDelta,
      totalFollowers,
      byPlatform: Array.from(byPlatform.entries())
        .map(([platform, v]) => ({
          platform,
          views: v.views,
          channelCount: v.channelCount,
          sharePct: totalViews > 0 ? (v.views / totalViews) * 100 : 0,
        }))
        .sort((a, b) => b.views - a.views),
      topChannel: channelPerf[0] ?? null,
    };
  }, [channelMetrics.data, channels]);

  if (channels.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nhân viên chưa phụ trách kênh nào — không có dữ liệu analytics.
        </CardContent>
      </Card>
    );
  }

  if (channelMetrics.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Tổng followers" value={formatCompact(stats.totalFollowers)} />
        <Stat label="Views (30d)" value={formatCompact(stats.totalViews)} />
        <Stat
          label="Δ Followers (30d)"
          value={
            stats.totalDelta >= 0
              ? `+${formatCompact(stats.totalDelta)}`
              : formatCompact(stats.totalDelta)
          }
          colorClass={
            stats.totalDelta > 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : stats.totalDelta < 0
                ? 'text-destructive'
                : ''
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Breakdown theo platform</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.byPlatform.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có data.</p>
          ) : (
            <div className="space-y-3">
              {stats.byPlatform.map((p) => (
                <div key={p.platform} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          'h-3 w-3 rounded-full',
                          PLATFORM_DOT[p.platform as keyof typeof PLATFORM_DOT],
                        )}
                      />
                      <span className="font-medium">
                        {PLATFORM_LABEL[p.platform as keyof typeof PLATFORM_LABEL]}
                      </span>
                      <span className="text-muted-foreground">
                        ({p.channelCount} kênh)
                      </span>
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatCompact(p.views)} views
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full',
                        PLATFORM_DOT[p.platform as keyof typeof PLATFORM_DOT],
                      )}
                      style={{ width: `${p.sharePct}%` }}
                    />
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground">
                    {p.sharePct.toFixed(1)}% tổng views
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {stats.topChannel && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top performing channel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold text-white',
                  PLATFORM_DOT[stats.topChannel.platform as keyof typeof PLATFORM_DOT],
                )}
              >
                {String(stats.topChannel.platform)[0]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {stats.topChannel.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatCompact(stats.topChannel.views)} views (30 ngày)
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-3 text-center">
          <p className="text-[11px] italic text-muted-foreground">
            "So sánh với tháng trước" — Sprint 10+.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ────────── Helpers ──────────

function Stat({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={cn('mt-0.5 text-xl font-bold tabular-nums', colorClass)}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function NotFoundState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <UserX className="h-10 w-10 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Không tìm thấy nhân sự</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            ID không tồn tại hoặc không thuộc tenant của bạn.
          </p>
        </div>
        <Button asChild>
          <Link href="/employees">
            <ArrowLeft className="h-4 w-4" />
            Về danh sách
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
