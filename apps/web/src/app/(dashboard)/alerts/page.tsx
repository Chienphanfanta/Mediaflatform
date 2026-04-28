'use client';

import { useMemo, useState } from 'react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertCircle,
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import type { AlertSeverity, AlertType } from '@prisma/client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SEVERITY_COLOR, SEVERITY_LABEL, TYPE_LABEL } from '@/lib/alerts-style';
import { ALERT_SEVERITIES, ALERT_TYPES } from '@/lib/schemas/alerts';
import {
  useAlerts,
  useDeleteAlert,
  useMarkAlertRead,
  useMarkAllAlertsRead,
  type AlertsFilter,
} from '@/hooks/use-alerts';

export default function AlertsPage() {
  const [filter, setFilter] = useState<AlertsFilter>({
    status: 'all',
    severities: [],
    types: [],
    page: 1,
    pageSize: 20,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error, isFetching } = useAlerts(filter);
  const markRead = useMarkAlertRead();
  const markAll = useMarkAllAlertsRead();
  const deleteAlert = useDeleteAlert();

  const items = data?.items ?? [];
  const pg = data?.pagination;

  const allSelected = items.length > 0 && items.every((a) => selected.has(a.id));
  const someSelected = items.some((a) => selected.has(a.id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((a) => a.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkMarkRead = async () => {
    await Promise.all(Array.from(selected).map((id) => markRead.mutateAsync(id)));
    setSelected(new Set());
  };

  const bulkDelete = async () => {
    if (!confirm(`Xoá ${selected.size} alert?`)) return;
    await Promise.all(Array.from(selected).map((id) => deleteAlert.mutateAsync(id)));
    setSelected(new Set());
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Bell className="h-7 w-7" />
          Cảnh báo
          {data && data.unreadCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {data.unreadCount} chưa đọc
            </Badge>
          )}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tất cả alert hệ thống tạo tự động — view drop, monetization risk, deadline...
        </p>
      </header>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được alerts</AlertTitle>
          <AlertDescription>{error?.message ?? 'Lỗi không xác định.'}</AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-4">
          {/* Status tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'unread', 'read'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter((f) => ({ ...f, status: s, page: 1 }))}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  filter.status === s
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 hover:bg-muted',
                )}
              >
                {s === 'all' ? 'Tất cả' : s === 'unread' ? 'Chưa đọc' : 'Đã đọc'}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              {data && data.unreadCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                >
                  <CheckCheck className="h-4 w-4" />
                  Đánh dấu đã đọc tất cả
                </Button>
              )}
            </div>
          </div>

          {/* Severity filter */}
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Mức độ:</span>
            {ALERT_SEVERITIES.map((s) => (
              <FilterChip
                key={s}
                checked={filter.severities.includes(s)}
                onToggle={() =>
                  setFilter((f) => ({
                    ...f,
                    page: 1,
                    severities: f.severities.includes(s)
                      ? f.severities.filter((x) => x !== s)
                      : [...f.severities, s],
                  }))
                }
              >
                <span className={cn('h-2 w-2 rounded-full', SEVERITY_COLOR[s].dot)} />
                <span>{SEVERITY_LABEL[s]}</span>
              </FilterChip>
            ))}
          </div>

          {/* Type filter (top 6 + "khác") */}
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Loại:</span>
            {(
              [
                'VIEW_DROP',
                'MONETIZATION_AT_RISK',
                'COPYRIGHT_STRIKE',
                'CHANNEL_INACTIVE',
                'SCHEDULED_POST_FAILED',
                'DEADLINE_APPROACHING',
                'TOKEN_EXPIRING',
                'API_ERROR',
              ] satisfies AlertType[]
            ).map((t) => (
              <FilterChip
                key={t}
                checked={filter.types.includes(t)}
                onToggle={() =>
                  setFilter((f) => ({
                    ...f,
                    page: 1,
                    types: f.types.includes(t)
                      ? f.types.filter((x) => x !== t)
                      : [...f.types, t],
                  }))
                }
              >
                <span className="text-xs">{TYPE_LABEL[t]}</span>
              </FilterChip>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="sticky top-16 z-10 flex items-center gap-3 rounded-lg border bg-card px-4 py-2 shadow-sm">
          <span className="text-sm">
            Đã chọn <strong>{selected.size}</strong>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={bulkMarkRead}
            disabled={markRead.isPending}
          >
            <Check className="h-4 w-4" />
            Đánh dấu đã đọc
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={bulkDelete}
            disabled={deleteAlert.isPending}
          >
            <Trash2 className="h-4 w-4" />
            Xoá
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            className="ml-auto"
          >
            Bỏ chọn
          </Button>
        </div>
      )}

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {/* Header row */}
          <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              disabled={items.length === 0}
              aria-label="Chọn tất cả"
            />
            <span className="flex-1">Alert</span>
            <span className="hidden w-32 sm:block">Kênh</span>
            <span className="hidden w-24 sm:block">Mức độ</span>
            <span className="w-32 text-right">Thời gian</span>
            <span className="w-16 text-right">Hành động</span>
          </div>

          {/* Items */}
          {isLoading && !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Bell className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium">Không có alert nào</p>
              <p className="text-xs text-muted-foreground">
                {filter.status === 'unread'
                  ? 'Bạn đã đọc tất cả alert.'
                  : 'Hệ thống chưa tạo alert nào với filter hiện tại.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((alert) => {
                const sev = SEVERITY_COLOR[alert.severity as AlertSeverity];
                const isSelected = selected.has(alert.id);
                return (
                  <li
                    key={alert.id}
                    className={cn(
                      'flex items-start gap-3 px-4 py-3 transition-colors',
                      !alert.isRead && 'bg-primary/5',
                      isSelected && 'bg-accent/40',
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(alert.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        {!alert.isRead && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              'text-sm leading-snug',
                              !alert.isRead && 'font-semibold',
                            )}
                          >
                            {alert.message}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {TYPE_LABEL[alert.type] ?? alert.type}
                          </p>
                        </div>
                      </div>
                    </div>

                    <span className="hidden w-32 truncate text-xs text-muted-foreground sm:block">
                      {alert.channel.name}
                    </span>

                    <div className="hidden w-24 sm:block">
                      <Badge
                        variant="outline"
                        className={cn('border text-[10px]', sev.badge)}
                      >
                        {SEVERITY_LABEL[alert.severity as AlertSeverity]}
                      </Badge>
                    </div>

                    <div
                      className="w-32 text-right text-xs text-muted-foreground"
                      title={format(parseISO(alert.createdAt), 'dd/MM/yyyy HH:mm', {
                        locale: vi,
                      })}
                    >
                      {formatDistanceToNow(parseISO(alert.createdAt), {
                        addSuffix: true,
                        locale: vi,
                      })}
                    </div>

                    <div className="flex w-16 justify-end gap-1">
                      {!alert.isRead && (
                        <button
                          type="button"
                          onClick={() => markRead.mutate(alert.id)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Đánh dấu đã đọc"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteAlert.mutate(alert.id)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Xoá"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pg && pg.total > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Hiển thị {(pg.page - 1) * pg.pageSize + 1}–
            {Math.min(pg.page * pg.pageSize, pg.total)} / {pg.total}
            {isFetching && ' · đang tải...'}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={pg.page <= 1}
              onClick={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2">
              {pg.page} / {pg.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pg.page >= pg.totalPages}
              onClick={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="flex items-center gap-1.5">{children}</span>
    </label>
  );
}
