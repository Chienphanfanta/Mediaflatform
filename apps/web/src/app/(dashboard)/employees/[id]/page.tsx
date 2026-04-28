// /employees/[id] — chi tiết nhân sự + channels + KPI section (Day 7).
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { AlertCircle, ArrowLeft, Plus, Target, Tv, UserX } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateKpiDialog } from '@/components/kpi/create-kpi-dialog';
import { KpiCard } from '@/components/kpi/kpi-card';
import { useKpiSummaryEmployee } from '@/hooks/use-kpi';
import { usePermission } from '@/hooks/use-permission';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import type { HRUserDetail } from '@/lib/types/hr';
import { cn } from '@/lib/utils';

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

export default function HRUserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;

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
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/employees">
          <ArrowLeft className="h-4 w-4" />
          Quay lại danh sách
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
        <UserDetailSkeleton />
      ) : (
        <>
          <UserHeader detail={data} />
          <ChannelsCard detail={data} />
          <EmployeeKpisSection employeeId={data.id} />
        </>
      )}
    </div>
  );
}

function NotFoundState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <UserX className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Không tìm thấy nhân sự</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            ID nhân sự không tồn tại hoặc đã bị xoá. Cũng có thể bạn không
            quản lý nhóm chứa nhân sự này.
          </p>
        </div>
        <Button asChild className="mt-2">
          <Link href="/employees">
            <ArrowLeft className="h-4 w-4" />
            Về danh sách nhân sự
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function UserDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function UserHeader({ detail }: { detail: HRUserDetail }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-4 p-6">
        <Avatar className="h-16 w-16">
          <AvatarImage src={detail.avatar ?? undefined} />
          <AvatarFallback className="text-lg">
            {detail.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{detail.name}</h1>
          <p className="text-sm text-muted-foreground">{detail.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{detail.primaryRole}</Badge>
            <Badge
              variant="secondary"
              className={cn(
                detail.status === 'ACTIVE' &&
                  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                detail.status === 'SUSPENDED' &&
                  'bg-destructive/10 text-destructive',
              )}
            >
              {detail.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              · Tham gia {format(new Date(detail.createdAt), 'dd/MM/yyyy', { locale: vi })}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {detail.groups.map((g) => (
              <Badge key={g.id} variant="secondary" className="text-xs">
                {g.name} · {g.role}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelsCard({ detail }: { detail: HRUserDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Tv className="h-4 w-4" />
          Kênh truy cập ({detail.channels.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {detail.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Không có kênh nào trong các nhóm của nhân sự này.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {detail.channels.map((c) => (
              <Link
                key={c.id}
                href={`/analytics/channels/${c.id}`}
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                <span
                  className={cn('h-2 w-2 rounded-full', PLATFORM_DOT[c.platform])}
                />
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">
                  · {PLATFORM_LABEL[c.platform]}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmployeeKpisSection({ employeeId }: { employeeId: string }) {
  const { atLeast } = usePermission();
  const canManage = atLeast('MANAGER');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error } = useKpiSummaryEmployee(employeeId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4" />
          KPI ({data?.totals.totalKpis ?? 0})
          {data?.totals.avgAchievement !== null &&
            data?.totals.avgAchievement !== undefined && (
              <span className="text-xs font-normal text-muted-foreground">
                · TB {data.totals.avgAchievement.toFixed(1)}%
              </span>
            )}
        </CardTitle>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Giao KPI
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            {error?.message ?? 'Lỗi tải KPI'}
          </p>
        ) : !data || data.kpis.length === 0 ? (
          <div className="rounded-md border border-dashed py-6 text-center">
            <Target className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">Chưa có KPI nào</p>
            <p className="text-xs text-muted-foreground">
              {canManage
                ? 'Giao KPI cho nhân viên này theo tháng/quý/năm.'
                : 'Manager chưa giao KPI cho period hiện tại.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.kpis.map((kpi) => (
              <KpiCard key={kpi.id} kpi={kpi} hideContext="employee" />
            ))}
          </div>
        )}
      </CardContent>

      <CreateKpiDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultEmployeeId={employeeId}
      />
    </Card>
  );
}
