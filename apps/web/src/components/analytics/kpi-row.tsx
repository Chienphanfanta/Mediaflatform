'use client';

import { Eye, Clock, UserPlus, Activity, DollarSign } from 'lucide-react';
import { KpiCard } from './kpi-card';
import { formatCompact, formatHours, formatPct, formatUsd, formatVndFromUsd } from '@/lib/format';
import type { AnalyticsSummaryResponse } from '@/lib/types/analytics-summary';

type Props = {
  data?: AnalyticsSummaryResponse['kpi'];
  isLoading: boolean;
};

export function KpiRow({ data, isLoading }: Props) {
  const k = data;

  return (
    // Mobile: 2x3 grid (5 cards, last item span 2 cột); tablet: 2 cols; desktop: 5 cols.
    // KpiCard mobile có valueClassName lớn hơn cho dễ đọc xa.
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5 [&>*:nth-child(5)]:col-span-2 lg:[&>*:nth-child(5)]:col-span-1">
      <KpiCard
        icon={Eye}
        title="Tổng View"
        valueLabel={k ? formatCompact(k.views.current) : '—'}
        deltaPct={k?.views.deltaPct}
        sparkline={k?.views.sparkline}
        sparklineColor="#3b82f6"
        isLoading={isLoading}
      />

      <KpiCard
        icon={Clock}
        title="Watch Time"
        valueLabel={k ? formatHours(k.watchTimeHours.current) : '—'}
        deltaPct={k?.watchTimeHours.deltaPct}
        progress={
          k
            ? {
                value: k.watchTimeHours.yearlyEstimate,
                max: k.watchTimeHours.threshold,
                label: `${formatHours(k.watchTimeHours.yearlyEstimate)} / 4,000h mục tiêu YouTube · ${formatPct(k.watchTimeHours.progressPct, { signed: false })}`,
              }
            : undefined
        }
        isLoading={isLoading}
      />

      <KpiCard
        icon={UserPlus}
        title="Subscribers mới"
        valueLabel={k ? formatCompact(k.subscribersGained.current) : '—'}
        deltaPct={k?.subscribersGained.deltaPct}
        sparkline={k?.subscribersGained.sparkline}
        sparklineColor="#10b981"
        isLoading={isLoading}
      />

      <KpiCard
        icon={Activity}
        title="Engagement Rate"
        valueLabel={k ? `${k.engagementRate.current.toFixed(2)}%` : '—'}
        deltaPct={k?.engagementRate.deltaPct}
        subLabel="Trung bình tất cả kênh"
        isLoading={isLoading}
      />

      <KpiCard
        icon={DollarSign}
        title="Doanh thu ước tính"
        valueLabel={k ? formatVndFromUsd(k.revenue.current) : '—'}
        subLabel={k ? `≈ ${formatUsd(k.revenue.current)} USD` : undefined}
        deltaPct={k?.revenue.deltaPct}
        isLoading={isLoading}
      />
    </div>
  );
}
