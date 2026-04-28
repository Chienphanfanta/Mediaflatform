'use client';

import { Search, X, LayoutGrid, List } from 'lucide-react';
import type { ChannelStatus, Platform } from '@prisma/client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PLATFORMS, PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';

export type ChannelView = 'grid' | 'list';

export type ChannelFilters = {
  /** multi-select: empty = "all" */
  platforms: Platform[];
  /** dropdown: 'all' | category string */
  category: string | 'all';
  /** dropdown: 'all' | userId of PRIMARY owner */
  primaryOwnerId: string | 'all';
  /** 'all' | ChannelStatus */
  status: ChannelStatus | 'all';
  /** search by name + externalUrl + accountId */
  query: string;
};

type Props = {
  filters: ChannelFilters;
  onChange: (next: ChannelFilters) => void;
  view: ChannelView;
  onViewChange: (view: ChannelView) => void;
  categories: string[];
  primaryOwners: Array<{ id: string; name: string }>;
  totalCount: number;
};

const STATUS_OPTIONS: Array<{ value: ChannelStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'ARCHIVED', label: 'Archived' },
];

export function ChannelFiltersBar({
  filters,
  onChange,
  view,
  onViewChange,
  categories,
  primaryOwners,
  totalCount,
}: Props) {
  const reset = () =>
    onChange({
      platforms: [],
      category: 'all',
      primaryOwnerId: 'all',
      status: 'all',
      query: '',
    });

  const active =
    filters.platforms.length > 0 ||
    filters.category !== 'all' ||
    filters.primaryOwnerId !== 'all' ||
    filters.status !== 'all' ||
    filters.query.length > 0;

  const togglePlatform = (p: Platform) => {
    const has = filters.platforms.includes(p);
    onChange({
      ...filters,
      platforms: has
        ? filters.platforms.filter((x) => x !== p)
        : [...filters.platforms, p],
    });
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      {/* Row 1: search + view toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm theo tên, URL, account ID..."
            className="h-9 pl-8 pr-8"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, query: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Xoá tìm kiếm"
              title="Xoá tìm kiếm"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* View toggle */}
        <div className="flex rounded-md border bg-background">
          <Button
            type="button"
            variant={view === 'grid' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 rounded-r-none border-r"
            onClick={() => onViewChange('grid')}
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={view === 'list' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 rounded-l-none"
            onClick={() => onViewChange('list')}
            title="List view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Row 2: platform pills (multi-select) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Platform:</span>
        <PillButton
          active={filters.platforms.length === 0}
          onClick={() => onChange({ ...filters, platforms: [] })}
        >
          Tất cả ({totalCount})
        </PillButton>
        {PLATFORMS.map((p) => (
          <PillButton
            key={p}
            active={filters.platforms.includes(p)}
            onClick={() => togglePlatform(p)}
          >
            <span className={cn('h-2 w-2 rounded-full', PLATFORM_DOT[p])} />
            {PLATFORM_LABEL[p]}
          </PillButton>
        ))}
      </div>

      {/* Row 3: dropdowns + status + reset */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filters.category}
          onChange={(e) => onChange({ ...filters, category: e.target.value })}
          className="flex h-9 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Filter by category"
        >
          <option value="all">— Mọi category —</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={filters.primaryOwnerId}
          onChange={(e) =>
            onChange({ ...filters, primaryOwnerId: e.target.value })
          }
          className="flex h-9 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Filter by primary owner"
        >
          <option value="all">— Mọi PRIMARY owner —</option>
          {primaryOwners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        <div className="flex rounded-md border bg-background">
          {STATUS_OPTIONS.map((s, i) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange({ ...filters, status: s.value })}
              className={cn(
                'h-9 px-3 text-xs transition-colors',
                i > 0 && 'border-l',
                filters.status === s.value
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {active && (
          <button
            type="button"
            onClick={reset}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Xoá filter
          </button>
        )}
      </div>
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
