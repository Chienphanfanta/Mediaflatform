'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useDashboardOverview } from '@/hooks/use-dashboard-overview';
import { MetricCards } from '@/components/dashboard/overview/metric-cards';
import { ViewsChart } from '@/components/dashboard/overview/views-chart';
import { ChannelHealth } from '@/components/dashboard/overview/channel-health';

// V2: bỏ các widget liên quan post creation (TopPostsChart, ScheduledPosts, TasksDue).
// Sprint 5/6 sẽ thay bằng KPI achievement widgets.
export default function DashboardOverviewPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboardOverview();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Tổng quan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bức tranh toàn cảnh về kênh truyền thông và nhân sự hôm nay.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Làm mới"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Làm mới
        </Button>
      </header>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được dữ liệu</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{error?.message ?? 'Lỗi không xác định.'}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Hàng 1 — Metric cards */}
      <MetricCards data={data?.metrics} isLoading={isLoading} />

      {/* Hàng 2 — Views chart (KPI cards Phase 6 sẽ replace với KPI achievement chart) */}
      <ViewsChart data={data?.viewsByDay} isLoading={isLoading} />

      {/* Hàng 3 — Channel health */}
      <ChannelHealth data={data?.channels} isLoading={isLoading} />
    </div>
  );
}
