'use client';

// KpiCard — shared component cho /kpi list, channel detail tab, employee detail.
// Layout:
//   Header: scope badge + period + status badge + dropdown menu (...)
//   Body: progress bar (avg %) + per-target breakdown (5 rows)
//   Footer: assigned by + notes (collapse)
import Link from 'next/link';
import { useState } from 'react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  ChevronDown,
  Crown,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Target,
  Trash2,
  Users,
} from 'lucide-react';
import type { KPIStatus } from '@prisma/client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDeleteKpi, useRecalculateKpi } from '@/hooks/use-kpi';
import { usePermission } from '@/hooks/use-permission';
import { formatCompact } from '@/lib/format';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { KpiWithRelations } from '@/lib/types/kpi';
import { KPIProgressBar } from './kpi-progress-bar';

const STATUS_META: Record<
  KPIStatus,
  { label: string; className: string; barClass: string }
> = {
  NOT_STARTED: {
    label: 'Chưa bắt đầu',
    className: 'border-muted-foreground/30 bg-muted text-muted-foreground',
    barClass: 'bg-muted-foreground/40',
  },
  IN_PROGRESS: {
    label: 'Đang chạy',
    className: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400',
    barClass: 'bg-blue-500',
  },
  ACHIEVED: {
    label: 'Đạt',
    className:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    barClass: 'bg-emerald-500',
  },
  EXCEEDED: {
    label: 'Vượt mức',
    className:
      'border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300',
    barClass: 'bg-emerald-600',
  },
  MISSED: {
    label: 'Không đạt',
    className: 'border-destructive/40 bg-destructive/10 text-destructive',
    barClass: 'bg-destructive',
  },
};

type Props = {
  kpi: KpiWithRelations;
  /** Hide channel/employee header rows nếu đã hiển thị ở context cha */
  hideContext?: 'channel' | 'employee';
};

export function KpiCard({ kpi, hideContext }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { atLeast } = usePermission();
  const canManage = atLeast('MANAGER');

  const recalc = useRecalculateKpi();
  const remove = useDeleteKpi();

  const meta = STATUS_META[kpi.status];

  const handleRecalc = () => recalc.mutate(kpi.id);
  const handleDelete = () => {
    if (!confirm(`Xoá KPI ${kpi.scope} (${formatPeriod(kpi)})?`)) return;
    remove.mutate(kpi.id);
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn('text-[10px]', meta.className)}
              >
                {meta.label}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {kpi.scope === 'PER_CHANNEL' ? (
                  <Target className="mr-1 h-2.5 w-2.5" />
                ) : (
                  <Users className="mr-1 h-2.5 w-2.5" />
                )}
                {kpi.scope === 'PER_CHANNEL' ? 'Kênh' : 'Nhân viên'}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {kpi.periodType === 'MONTHLY'
                  ? 'Tháng'
                  : kpi.periodType === 'QUARTERLY'
                    ? 'Quý'
                    : 'Năm'}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatPeriod(kpi)}
              </span>
            </div>

            {/* Subject row: channel or employee */}
            {hideContext !== 'channel' && kpi.channel && (
              <Link
                href={`/channels/${kpi.channel.id}`}
                className="flex items-center gap-1.5 text-sm font-medium hover:underline"
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    PLATFORM_DOT[kpi.channel.platform],
                  )}
                />
                {kpi.channel.name}
                <span className="text-xs font-normal text-muted-foreground">
                  ({PLATFORM_LABEL[kpi.channel.platform]})
                </span>
              </Link>
            )}
            {hideContext !== 'employee' && (
              <Link
                href={`/employees/${kpi.employee.id}`}
                className="flex items-center gap-1.5 text-xs hover:underline"
              >
                <Avatar className="h-5 w-5">
                  <AvatarImage src={kpi.employee.avatar ?? undefined} />
                  <AvatarFallback className="text-[8px]">
                    {kpi.employee.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium">{kpi.employee.name}</span>
                <span className="text-muted-foreground">
                  {kpi.scope === 'PER_EMPLOYEE'
                    ? '(cross-channel)'
                    : '(owner)'}
                </span>
              </Link>
            )}
          </div>

          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="KPI actions"
                  title="Tuỳ chọn"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={handleRecalc}
                  disabled={recalc.isPending}
                >
                  {recalc.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Recalc ngay
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit (Day 7+)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDelete}
                  disabled={remove.isPending}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Xoá KPI
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Progress bar (color-coded theo % thresholds) */}
        <KPIProgressBar
          percent={kpi.achievementPercent}
          label={
            kpi.achievementPercent === null
              ? 'Chưa tính achievement'
              : 'Achievement trung bình'
          }
        />

        {/* Per-target breakdown — collapsible */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground"
          aria-label="Toggle per-target breakdown"
        >
          <span>Chi tiết targets</span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </button>

        {expanded && (
          <div className="space-y-1.5 rounded-md bg-muted/30 p-2">
            <TargetRow
              label="Followers"
              target={kpi.targetFollowers}
              format={(n) => formatCompact(n)}
            />
            <TargetRow
              label="Δ Followers"
              target={kpi.targetFollowersGain}
              format={(n) => formatCompact(n)}
            />
            <TargetRow
              label="Views"
              target={kpi.targetViews}
              format={(n) => formatCompact(n)}
            />
            <TargetRow
              label="Watch time (h)"
              target={kpi.targetWatchTime}
              format={(n) => formatCompact(n)}
            />
            <TargetRow
              label="Engagement"
              target={kpi.targetEngagement}
              format={(n) => `${n.toFixed(1)}%`}
            />
            {kpi.notes && (
              <p className="border-t pt-2 text-[11px] italic text-muted-foreground">
                {kpi.notes}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground/70">
              <Crown className="mr-0.5 inline h-2.5 w-2.5" />
              Gán bởi{' '}
              <Link
                href={`/employees/${kpi.assignedBy.id}`}
                className="hover:underline"
              >
                {kpi.assignedBy.name}
              </Link>{' '}
              · {format(new Date(kpi.assignedAt), 'dd/MM/yyyy', { locale: vi })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TargetRow({
  label,
  target,
  format,
}: {
  label: string;
  target: number | null;
  format: (n: number) => string;
}) {
  if (target === null) {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground/50">— không set —</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">Target: {format(target)}</span>
    </div>
  );
}

function formatPeriod(kpi: { periodStart: string; periodEnd: string }): string {
  const start = format(new Date(kpi.periodStart), 'dd/MM', { locale: vi });
  const end = format(new Date(kpi.periodEnd), 'dd/MM/yyyy', { locale: vi });
  return `${start} → ${end}`;
}

