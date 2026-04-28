'use client';

import { Search, X } from 'lucide-react';
import type { Platform } from '@prisma/client';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PLATFORMS, PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';

export type ChannelFilters = {
  platform: Platform | 'all';
  groupId: string | 'all';
  query: string;
};

type Props = {
  filters: ChannelFilters;
  onChange: (next: ChannelFilters) => void;
  groups: Array<{ id: string; name: string; count: number }>;
  totalCount: number;
};

export function ChannelFiltersBar({ filters, onChange, groups, totalCount }: Props) {
  const reset = () => onChange({ platform: 'all', groupId: 'all', query: '' });
  const active =
    filters.platform !== 'all' ||
    filters.groupId !== 'all' ||
    filters.query.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Tìm kênh theo tên..."
          className="h-9 pl-8 pr-8"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, query: '' })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Platform pills */}
      <div className="flex flex-wrap gap-1.5">
        <PillButton
          active={filters.platform === 'all'}
          onClick={() => onChange({ ...filters, platform: 'all' })}
        >
          Tất cả ({totalCount})
        </PillButton>
        {PLATFORMS.map((p) => (
          <PillButton
            key={p}
            active={filters.platform === p}
            onClick={() => onChange({ ...filters, platform: p })}
          >
            <span className={cn('h-2 w-2 rounded-full', PLATFORM_DOT[p])} />
            {PLATFORM_LABEL[p]}
          </PillButton>
        ))}
      </div>

      {/* Group select */}
      <select
        value={filters.groupId}
        onChange={(e) => onChange({ ...filters, groupId: e.target.value })}
        className="flex h-9 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="all">— Mọi group —</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.count})
          </option>
        ))}
      </select>

      {active && (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Xoá filter
        </button>
      )}
    </div>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-background hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

// Placeholder
void Badge;
