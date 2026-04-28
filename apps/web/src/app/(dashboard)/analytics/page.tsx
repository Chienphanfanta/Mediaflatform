'use client';

import { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  useAnalyticsSummary,
  type AnalyticsPeriodState,
} from '@/hooks/use-analytics-summary';
import { ExportButton } from '@/components/analytics/export-button';
import { PeriodSelector } from '@/components/analytics/period-selector';
import { KpiRow } from '@/components/analytics/kpi-row';
import { ViewsChart } from '@/components/analytics/views-chart';
import { PlatformBreakdown } from '@/components/analytics/platform-breakdown';

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriodState>({
    mode: 'preset',
    period: '30d',
  });
  const { data, isLoading, isError, error, refetch, isFetching } =
    useAnalyticsSummary(period);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hiệu suất tổng hợp các kênh truyền thông.
            {data && ` · ${data.channelCount} kênh`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Làm mới</span>
          </Button>
          <ExportButton period={period} />
        </div>
      </header>

      {/* SECTION 1 — Period selector */}
      <PeriodSelector value={period} onChange={setPeriod} />

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được analytics</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{error?.message ?? 'Lỗi không xác định.'}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* SECTION 2 — KPI row */}
      <KpiRow data={data?.kpi} isLoading={isLoading} />

      {/* SECTION 3 — Views chart */}
      <ViewsChart data={data?.viewsByPlatformDaily} isLoading={isLoading} />

      {/* SECTION 4 — Platform breakdown */}
      <PlatformBreakdown data={data?.platformBreakdown} isLoading={isLoading} />
    </div>
  );
}
