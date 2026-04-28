'use client';

import { Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Placeholder data — Phase 1 sẽ fetch /api/v1/alerts qua React Query
const MOCK_ALERTS = [
  {
    id: '1',
    title: 'YouTube: views giảm 35% so với 7 ngày trước',
    time: '2 giờ trước',
    unread: true,
  },
  {
    id: '2',
    title: 'Facebook: access token sẽ hết hạn trong 5 ngày',
    time: '1 ngày trước',
    unread: true,
  },
  {
    id: '3',
    title: 'Instagram: API rate limit exceeded',
    time: '3 ngày trước',
    unread: false,
  },
];

export function Notifications() {
  const unread = MOCK_ALERTS.filter((a) => a.unread).length;

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
              {unread}
            </Badge>
          )}
          <span className="sr-only">Thông báo ({unread} chưa đọc)</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Thông báo</span>
          {unread > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {unread} chưa đọc
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MOCK_ALERTS.length === 0 ? (
          <DropdownMenuItem disabled className="justify-center text-sm text-muted-foreground">
            Không có thông báo mới
          </DropdownMenuItem>
        ) : (
          MOCK_ALERTS.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex flex-col items-start gap-1 py-2.5"
            >
              <div className="flex w-full items-start gap-2">
                {n.unread && (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                )}
                <span className="flex-1 text-sm font-medium leading-snug">{n.title}</span>
              </div>
              <span className="ml-3.5 text-xs text-muted-foreground">{n.time}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="justify-center text-sm font-medium">
          Xem tất cả thông báo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
