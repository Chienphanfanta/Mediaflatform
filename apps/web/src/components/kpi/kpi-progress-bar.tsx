'use client';

// KPIProgressBar — color-coded progress bar theo % achievement.
//
// Threshold (per V2 spec):
//   < 70%      → đỏ (destructive)
//   70 - 99%   → vàng (amber)
//   100 - 120% → xanh lá (emerald)
//   > 120%     → xanh dương (blue) — exceeded
//
// Tooltip-on-hover: target + actual + percent breakdown nếu có.
import { cn } from '@/lib/utils';

export type KpiBarColor = 'destructive' | 'amber' | 'emerald' | 'blue' | 'muted';

export function thresholdColor(percent: number | null | undefined): KpiBarColor {
  if (percent == null) return 'muted';
  if (percent > 120) return 'blue';
  if (percent >= 100) return 'emerald';
  if (percent >= 70) return 'amber';
  return 'destructive';
}

const BAR_CLASS: Record<KpiBarColor, string> = {
  destructive: 'bg-destructive',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  blue: 'bg-blue-500',
  muted: 'bg-muted-foreground/40',
};

const TEXT_CLASS: Record<KpiBarColor, string> = {
  destructive: 'text-destructive',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  blue: 'text-blue-600 dark:text-blue-400',
  muted: 'text-muted-foreground',
};

type Props = {
  /** % achievement (0-200+). null = chưa tính */
  percent: number | null | undefined;
  /** Target value (optional — hiện trong tooltip/label) */
  target?: number | null;
  /** Actual value (optional — hiện trong tooltip/label) */
  actual?: number | null;
  /** Label trên bar (vd "Views", "Followers") */
  label?: string;
  /** Format function cho target/actual số (vd formatCompact) */
  formatValue?: (n: number) => string;
  /** Compact mode: chỉ hiển thị bar + percent, không label rows */
  compact?: boolean;
  className?: string;
};

export function KPIProgressBar({
  percent,
  target,
  actual,
  label,
  formatValue,
  compact,
  className,
}: Props) {
  const color = thresholdColor(percent);
  // Cap visual width at 100% — overflow (>100%) hiển thị qua percent text
  const barWidth = Math.min(percent ?? 0, 100);

  const tooltipParts: string[] = [];
  if (target != null && formatValue) tooltipParts.push(`Target: ${formatValue(target)}`);
  if (actual != null && formatValue) tooltipParts.push(`Actual: ${formatValue(actual)}`);
  if (percent != null) tooltipParts.push(`Achievement: ${percent.toFixed(1)}%`);
  const tooltip = tooltipParts.join(' · ');

  if (compact) {
    return (
      <div className={cn('space-y-0.5', className)} title={tooltip}>
        <div className="flex items-center justify-between text-[10px]">
          {label && <span className="truncate text-muted-foreground">{label}</span>}
          <span className={cn('shrink-0 font-medium tabular-nums', TEXT_CLASS[color])}>
            {percent != null ? `${percent.toFixed(0)}%` : '—'}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full transition-all', BAR_CLASS[color])}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-1', className)} title={tooltip}>
      {(label || percent != null) && (
        <div className="flex items-center justify-between text-xs">
          {label && <span className="text-muted-foreground">{label}</span>}
          {percent != null && (
            <div className="flex items-baseline gap-1.5">
              {target != null && actual != null && formatValue && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatValue(actual)}/{formatValue(target)}
                </span>
              )}
              <span className={cn('font-medium tabular-nums', TEXT_CLASS[color])}>
                {percent.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', BAR_CLASS[color])}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}
