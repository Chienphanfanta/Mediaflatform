// /employees — danh sách nhân viên với filter + sort + table (desktop) /
// card (mobile auto via Tailwind responsive classes).
//
// Day 9 Plan B: skip Bulk Import + Avatar upload (placeholder buttons).
'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import type { MemberRole, UserStatus } from '@prisma/client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AddEmployeeDialog } from '@/components/employees/add-employee-dialog';
import { useDepartments } from '@/hooks/use-departments';
import { usePermission } from '@/hooks/use-permission';
import { useUsers } from '@/hooks/use-users';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { HRUserListItem } from '@/lib/types/hr';

type SortKey = 'name' | 'joinDate' | 'department' | 'channels';

const STATUS_OPTIONS: Array<{ value: UserStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'ACTIVE', label: 'Đang hoạt động' },
  { value: 'SUSPENDED', label: 'Tạm dừng' },
  { value: 'INVITED', label: 'Đã mời' },
];

const ROLE_OPTIONS: Array<{ value: MemberRole; label: string }> = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'VIEWER', label: 'Viewer' },
];

const STATUS_BADGE: Record<UserStatus, string> = {
  ACTIVE:
    'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  SUSPENDED: 'border-destructive/40 bg-destructive/10 text-destructive',
  INVITED:
    'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
};

export default function EmployeesPage() {
  const { atLeast } = usePermission();
  const canCreate = atLeast('GROUP_ADMIN');

  // Filters state
  const [query, setQuery] = useState('');
  const [departmentId, setDepartmentId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all');
  const [roleFilters, setRoleFilters] = useState<MemberRole[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [addOpen, setAddOpen] = useState(false);

  const { data: deptsResp } = useDepartments();
  const { data, isLoading, isError, error } = useUsers({
    expand: true,
    departmentId: departmentId === 'all' ? undefined : departmentId,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });

  const items = data?.items ?? [];
  const departments = deptsResp?.items ?? [];

  // Client-side filter (search + role multi-select) + sort
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = items.filter((u) => {
      if (q) {
        const haystack = [u.name, u.email, u.phone ?? ''].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (roleFilters.length > 0) {
        const hasRole = u.groups.some((g) => roleFilters.includes(g.role));
        if (!hasRole) return false;
      }
      return true;
    });

    // Sort
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case 'joinDate': {
          const ad = a.joinDate ? new Date(a.joinDate).getTime() : 0;
          const bd = b.joinDate ? new Date(b.joinDate).getTime() : 0;
          return bd - ad; // most recent first
        }
        case 'department':
          return (a.department?.name ?? '').localeCompare(
            b.department?.name ?? '',
          );
        case 'channels':
          return (b.channels?.length ?? 0) - (a.channels?.length ?? 0);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return out;
  }, [items, query, roleFilters, sortKey]);

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const headers = [
      'Name',
      'Email',
      'Phone',
      'Position',
      'Department',
      'Primary Role',
      'Channels',
      'KPI Avg %',
      'Status',
      'Join Date',
    ];
    const rows = filtered.map((u) => [
      u.name,
      u.email,
      u.phone ?? '',
      u.position ?? '',
      u.department?.name ?? '',
      u.primaryRole,
      String(u.channels?.length ?? 0),
      u.kpiAvgAchievement != null ? u.kpiAvgAchievement.toFixed(1) : '',
      u.status,
      u.joinDate ? new Date(u.joinDate).toISOString().slice(0, 10) : '',
    ]);
    const csv = '﻿' + // BOM for Excel UTF-8
      [headers, ...rows]
        .map((r) =>
          r
            .map((c) => `"${String(c).replace(/"/g, '""')}"`)
            .join(','),
        )
        .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleRole = (role: MemberRole) => {
    setRoleFilters((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const resetFilters = () => {
    setQuery('');
    setDepartmentId('all');
    setStatusFilter('all');
    setRoleFilters([]);
    setSortKey('name');
  };

  const hasFilters =
    query !== '' ||
    departmentId !== 'all' ||
    statusFilter !== 'all' ||
    roleFilters.length > 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Users className="h-7 w-7" />
            Nhân sự
            {data && (
              <span className="text-sm font-normal text-muted-foreground">
                ({data.total})
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quản lý nhân viên + phòng ban + kênh phụ trách + KPI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Bulk import — Sprint 10+"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Bulk import
          </Button>
          {canCreate && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Thêm nhân viên
            </Button>
          )}
        </div>
      </header>

      {/* Filter bar */}
      <Card>
        <CardContent className="space-y-3 p-3">
          {/* Row 1: search + sort */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm theo tên, email, phone..."
                className="h-9 pl-8 pr-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Xoá tìm kiếm"
                  title="Xoá tìm kiếm"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="flex h-9 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Sort"
            >
              <option value="name">Sort: Tên</option>
              <option value="joinDate">Sort: Ngày join</option>
              <option value="department">Sort: Phòng ban</option>
              <option value="channels">Sort: Số kênh</option>
            </select>
          </div>

          {/* Row 2: dept + status pills */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Filter by department"
            >
              <option value="all">— Mọi phòng ban —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d._count.members})
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Status:
              </span>
              {STATUS_OPTIONS.map((s) => (
                <Pill
                  key={s.value}
                  active={statusFilter === s.value}
                  onClick={() => setStatusFilter(s.value)}
                >
                  {s.label}
                </Pill>
              ))}
            </div>
          </div>

          {/* Row 3: role multi-select */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Role:
            </span>
            {ROLE_OPTIONS.map((r) => (
              <Pill
                key={r.value}
                active={roleFilters.includes(r.value)}
                onClick={() => toggleRole(r.value)}
              >
                {r.label}
              </Pill>
            ))}
            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
                Xoá filter
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được nhân sự</AlertTitle>
          <AlertDescription>
            {error?.message ?? 'Lỗi không xác định.'}
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : filtered.length === 0 ? (
        <EmptyState canCreate={canCreate} onCreate={() => setAddOpen(true)} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="w-10 px-3 py-2 font-medium">
                          <span className="sr-only">Avatar</span>
                        </th>
                        <th className="px-3 py-2 font-medium">Tên</th>
                        <th className="px-3 py-2 font-medium">Position</th>
                        <th className="px-3 py-2 font-medium">Phòng ban</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 font-medium">Channels</th>
                        <th className="px-3 py-2 font-medium">KPI</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="w-16 px-3 py-2">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filtered.map((u) => (
                        <EmployeeRow key={u.id} u={u} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 lg:hidden">
            {filtered.map((u) => (
              <EmployeeMobileCard key={u.id} u={u} />
            ))}
          </div>
        </>
      )}

      {addOpen && (
        <AddEmployeeDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

// ────────── Sub-components ──────────

function EmployeeRow({ u }: { u: HRUserListItem }) {
  return (
    <tr className="transition-colors hover:bg-accent/40">
      <td className="px-3 py-2.5">
        <Avatar className="h-8 w-8">
          <AvatarImage src={u.avatar ?? undefined} />
          <AvatarFallback className="text-[10px]">
            {u.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </td>
      <td className="px-3 py-2.5">
        <Link
          href={`/employees/${u.id}`}
          className="block hover:underline"
        >
          <div className="font-medium">{u.name}</div>
          <div className="text-xs text-muted-foreground">{u.email}</div>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-xs">
        {u.position ?? <span className="text-muted-foreground/60">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {u.department ? (
          <Badge
            variant="secondary"
            className="text-[10px]"
            style={
              u.department.color
                ? {
                    backgroundColor: `${u.department.color}20`,
                    color: u.department.color,
                  }
                : undefined
            }
          >
            {u.department.name}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <Badge variant="outline" className="text-[10px]">
          {u.primaryRole}
        </Badge>
      </td>
      <td className="px-3 py-2.5">
        <ChannelsList channels={u.channels ?? []} />
      </td>
      <td className="px-3 py-2.5">
        <KpiBadge percent={u.kpiAvgAchievement ?? null} />
      </td>
      <td className="px-3 py-2.5">
        <Badge
          variant="outline"
          className={cn('text-[10px]', STATUS_BADGE[u.status])}
        >
          {u.status === 'ACTIVE'
            ? 'Active'
            : u.status === 'SUSPENDED'
              ? 'Tạm dừng'
              : 'Đã mời'}
        </Badge>
      </td>
      <td className="px-3 py-2.5 text-right">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/employees/${u.id}`}>Chi tiết →</Link>
        </Button>
      </td>
    </tr>
  );
}

function EmployeeMobileCard({ u }: { u: HRUserListItem }) {
  return (
    <Link href={`/employees/${u.id}`}>
      <Card className="transition-colors hover:border-primary/40">
        <CardContent className="space-y-2 p-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={u.avatar ?? undefined} />
              <AvatarFallback>{u.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{u.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {u.position ?? u.email}
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn('text-[10px]', STATUS_BADGE[u.status])}
            >
              {u.status === 'ACTIVE' ? 'Active' : 'Off'}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {u.department && (
              <Badge
                variant="secondary"
                className="text-[10px]"
                style={
                  u.department.color
                    ? {
                        backgroundColor: `${u.department.color}20`,
                        color: u.department.color,
                      }
                    : undefined
                }
              >
                {u.department.name}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {u.primaryRole}
            </Badge>
            <ChannelsList channels={u.channels ?? []} />
            <KpiBadge percent={u.kpiAvgAchievement ?? null} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ChannelsList({
  channels,
}: {
  channels: NonNullable<HRUserListItem['channels']>;
}) {
  if (channels.length === 0) {
    return (
      <span className="text-xs text-muted-foreground/60">— 0 —</span>
    );
  }
  const tooltip = channels.map((c) => c.name).join(' · ');
  return (
    <div
      className="flex items-center gap-1 text-xs"
      title={tooltip}
    >
      <span className="font-medium tabular-nums">{channels.length}</span>
      <div className="flex -space-x-1">
        {channels.slice(0, 4).map((c) => (
          <span
            key={c.id}
            className={cn(
              'flex h-3.5 w-3.5 items-center justify-center rounded-full border border-card text-[7px] font-bold text-white',
              PLATFORM_DOT[c.platform],
            )}
            aria-label={PLATFORM_LABEL[c.platform]}
          >
            {PLATFORM_LABEL[c.platform][0]}
          </span>
        ))}
        {channels.length > 4 && (
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-card bg-muted text-[7px]">
            +{channels.length - 4}
          </span>
        )}
      </div>
    </div>
  );
}

function KpiBadge({ percent }: { percent: number | null }) {
  if (percent === null) {
    return (
      <span className="text-xs text-muted-foreground/60">— No KPI —</span>
    );
  }
  const cls =
    percent >= 120
      ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400'
      : percent >= 100
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        : percent >= 70
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-destructive/40 bg-destructive/10 text-destructive';
  return (
    <Badge variant="outline" className={cn('text-[10px] tabular-nums', cls)}>
      {percent.toFixed(1)}%
    </Badge>
  );
}

function Pill({
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
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
        <Users className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium">Không có nhân viên nào</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {canCreate
            ? 'Đổi filter hoặc thêm nhân viên đầu tiên.'
            : 'Liên hệ Tenant Admin để thêm nhân viên.'}
        </p>
        {canCreate && (
          <Button className="mt-2" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            Thêm nhân viên
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
