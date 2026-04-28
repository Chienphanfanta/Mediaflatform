'use client';

// Tab "KPI" — list KPIs gắn channel này (PER_CHANNEL) + button giao KPI mới.
import { useState } from 'react';
import { Plus, Target } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateKpiDialog } from '@/components/kpi/create-kpi-dialog';
import { KpiCard } from '@/components/kpi/kpi-card';
import { useKpiSummaryChannel } from '@/hooks/use-kpi';
import { usePermission } from '@/hooks/use-permission';

type Props = { channelId: string };

export function TabKpi({ channelId }: Props) {
  const { atLeast } = usePermission();
  const canManage = atLeast('MANAGER');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error } = useKpiSummaryChannel(channelId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          {error?.message ?? 'Lỗi tải KPI'}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const totals = data.totals;

  return (
    <div className="space-y-4">
      {/* Header với totals + create button */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              KPIs đang active của kênh
            </p>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-2xl font-bold tabular-nums">
                {totals.totalKpis}
              </span>
              {totals.avgAchievement !== null && (
                <span className="text-sm text-muted-foreground">
                  Trung bình:{' '}
                  <span className="font-medium tabular-nums">
                    {totals.avgAchievement.toFixed(1)}%
                  </span>
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {Object.entries(totals.byStatus)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' · ')}
              </span>
            </div>
          </div>
          {canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Giao KPI cho kênh này
            </Button>
          )}
        </CardContent>
      </Card>

      {/* List */}
      {data.kpis.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Target className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">Chưa có KPI nào</p>
            <p className="max-w-md text-xs text-muted-foreground">
              {canManage
                ? 'Giao KPI để track performance kênh theo period.'
                : 'Chưa có KPI nào được giao cho kênh này trong period hiện tại.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.kpis.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} hideContext="channel" />
          ))}
        </div>
      )}

      <CreateKpiDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultChannelId={channelId}
      />
    </div>
  );
}
