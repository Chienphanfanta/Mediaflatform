// /kpi — list KPIs với filter scope/status/periodType + search.
'use client';

import { useState } from 'react';
import { AlertCircle, Plus, Target } from 'lucide-react';
import type { KPIScope, KPIStatus, PeriodType } from '@prisma/client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateKpiDialog } from '@/components/kpi/create-kpi-dialog';
import { KpiCard } from '@/components/kpi/kpi-card';
import { useKpis } from '@/hooks/use-kpi';
import { usePermission } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';

type Filters = {
  scope: KPIScope | 'all';
  status: KPIStatus | 'all';
  periodType: PeriodType | 'all';
};

const STATUS_OPTIONS: Array<{ value: KPIStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'IN_PROGRESS', label: 'Đang chạy' },
  { value: 'ACHIEVED', label: 'Đạt' },
  { value: 'EXCEEDED', label: 'Vượt' },
  { value: 'MISSED', label: 'Không đạt' },
  { value: 'NOT_STARTED', label: 'Chưa bắt đầu' },
];

const SCOPE_OPTIONS: Array<{ value: KPIScope | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'PER_CHANNEL', label: 'Theo kênh' },
  { value: 'PER_EMPLOYEE', label: 'Theo nhân viên' },
];

const PERIOD_OPTIONS: Array<{ value: PeriodType | 'all'; label: string }> = [
  { value: 'all', label: 'Mọi period' },
  { value: 'MONTHLY', label: 'Tháng' },
  { value: 'QUARTERLY', label: 'Quý' },
  { value: 'YEARLY', label: 'Năm' },
];

export default function KpiPage() {
  const { atLeast } = usePermission();
  const canManage = atLeast('MANAGER');

  const [filters, setFilters] = useState<Filters>({
    scope: 'all',
    status: 'all',
    periodType: 'all',
  });
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error } = useKpis({
    scope: filters.scope === 'all' ? undefined : filters.scope,
    status: filters.status === 'all' ? undefined : filters.status,
    periodType: filters.periodType === 'all' ? undefined : filters.periodType,
  });

  const kpis = data?.items ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Target className="h-7 w-7" />
            KPI
            {data && (
              <span className="text-sm font-normal text-muted-foreground">
                ({data.total})
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Chỉ tiêu giao theo kênh hoặc theo nhân viên + theo dõi achievement %.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Giao KPI mới
          </Button>
        )}
      </header>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <FilterGroup
            label="Phạm vi"
            value={filters.scope}
            options={SCOPE_OPTIONS}
            onChange={(v) =>
              setFilters((f) => ({ ...f, scope: v as Filters['scope'] }))
            }
          />
          <FilterGroup
            label="Status"
            value={filters.status}
            options={STATUS_OPTIONS}
            onChange={(v) =>
              setFilters((f) => ({ ...f, status: v as Filters['status'] }))
            }
          />
          <FilterGroup
            label="Period"
            value={filters.periodType}
            options={PERIOD_OPTIONS}
            onChange={(v) =>
              setFilters((f) => ({
                ...f,
                periodType: v as Filters['periodType'],
              }))
            }
          />
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
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : kpis.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Target className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">Chưa có KPI nào</p>
            <p className="text-xs text-muted-foreground">
              {canManage
                ? 'Giao KPI đầu tiên để bắt đầu theo dõi performance.'
                : 'Liên hệ Manager để giao KPI.'}
            </p>
            {canManage && (
              <Button className="mt-2" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Giao KPI mới
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} />
          ))}
        </div>
      )}

      <CreateKpiDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}:</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
            value === o.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'hover:bg-accent',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
