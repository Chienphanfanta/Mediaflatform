'use client';

import { CalendarRange } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AnalyticsPeriodState } from '@/hooks/use-analytics-summary';

type Props = {
  value: AnalyticsPeriodState;
  onChange: (next: AnalyticsPeriodState) => void;
};

const PRESETS: Array<{ key: '7d' | '30d' | '90d'; label: string }> = [
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: '90d', label: '90 ngày' },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function PeriodSelector({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-md border">
        {PRESETS.map((p) => {
          const active = value.mode === 'preset' && value.period === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange({ mode: 'preset', period: p.key })}
              className={cn(
                'px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent',
              )}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() =>
            onChange({ mode: 'custom', from: daysAgoISO(14), to: todayISO() })
          }
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors border-l',
            value.mode === 'custom'
              ? 'bg-primary text-primary-foreground'
              : 'bg-background hover:bg-accent',
          )}
        >
          <CalendarRange className="h-3.5 w-3.5" />
          Tuỳ chỉnh
        </button>
      </div>

      {value.mode === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="h-8 w-[160px]"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span className="text-muted-foreground">→</span>
          <Input
            type="date"
            className="h-8 w-[160px]"
            value={value.to}
            min={value.from || undefined}
            max={todayISO()}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
