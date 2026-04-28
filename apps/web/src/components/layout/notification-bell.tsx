'use client';

import Link from 'next/link';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Bell, Check, CheckCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  useMarkAlertRead,
  useMarkAllAlertsRead,
  useUnreadAlerts,
} from '@/hooks/use-alerts';
import { SEVERITY_COLOR, SEVERITY_LABEL, TYPE_LABEL } from '@/lib/alerts-style';

export function NotificationBell() {
  const { data, isLoading } = useUnreadAlerts();
  const markRead = useMarkAlertRead();
  const markAll = useMarkAllAlertsRead();

  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 text-[10px]"
            >
              {unread > 99 ? '99+' : unread}
            </Badge>
          )}
          <span className="sr-only">Thông báo ({unread} chưa đọc)</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            Thông báo
            {unread > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {unread} chưa đọc
              </Badge>
            )}
          </span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <CheckCheck className="h-3 w-3" />
              Đọc tất cả
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {isLoading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted/50" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <DropdownMenuItem disabled className="justify-center py-6 text-sm text-muted-foreground">
            ✅ Không có thông báo mới
          </DropdownMenuItem>
        ) : (
          items.map((alert) => {
            const sev = SEVERITY_COLOR[alert.severity];
            return (
              <DropdownMenuItem
                key={alert.id}
                className="flex flex-col items-start gap-1 py-2.5"
                onSelect={(e) => {
                  e.preventDefault();
                  markRead.mutate(alert.id);
                }}
              >
                <div className="flex w-full items-start gap-2">
                  <span
                    className={cn(
                      'mt-1 h-2 w-2 shrink-0 rounded-full',
                      sev.dot,
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{alert.message}</p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge
                        variant="outline"
                        className={cn('h-4 px-1 text-[10px] border', sev.badge)}
                      >
                        {SEVERITY_LABEL[alert.severity]}
                      </Badge>
                      <span>·</span>
                      <span className="truncate">
                        {alert.channel.name} · {TYPE_LABEL[alert.type] ?? alert.type}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/70">
                      {formatDistanceToNow(parseISO(alert.createdAt), {
                        addSuffix: true,
                        locale: vi,
                      })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      markRead.mutate(alert.id);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                    title="Đánh dấu đã đọc"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>
              </DropdownMenuItem>
            );
          })
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="justify-center text-sm font-medium">
          <Link href="/alerts">Xem tất cả thông báo</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
