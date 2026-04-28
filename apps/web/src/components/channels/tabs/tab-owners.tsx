'use client';

// Tab "Lịch sử owners" — list ownerships hiện tại sorted theo assignedAt desc.
// Note Plan A3: V2 không track full audit history (chỉ trạng thái current);
// "history" ở đây = current ownerships sắp xếp theo thời gian được gán.
import Link from 'next/link';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Crown, Users } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ChannelOwnershipDetail } from '@/lib/types/channel-management';

type Props = { ownerships: ChannelOwnershipDetail[] };

export function TabOwners({ ownerships }: Props) {
  const sorted = [...ownerships].sort((a, b) => {
    // PRIMARY trước, sau đó theo assignedAt desc
    if (a.role !== b.role) return a.role === 'PRIMARY' ? -1 : 1;
    return new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime();
  });

  if (sorted.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Users className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Chưa có owner nào</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Gán PRIMARY owner để có người chịu trách nhiệm sync + KPI.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Owners ({sorted.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {sorted.map((o) => (
            <li
              key={o.employeeId}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
            >
              <Avatar className="h-9 w-9">
                <AvatarImage src={o.avatar ?? undefined} />
                <AvatarFallback className="text-xs">
                  {o.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/employees/${o.employeeId}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {o.name}
                </Link>
                <div className="truncate text-xs text-muted-foreground">
                  {o.email}
                </div>
              </div>
              <div className="text-right">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px]',
                    o.role === 'PRIMARY' &&
                      'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                  )}
                >
                  {o.role === 'PRIMARY' && <Crown className="mr-1 h-2.5 w-2.5" />}
                  {o.role}
                </Badge>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Gán{' '}
                  {format(new Date(o.assignedAt), 'dd/MM/yyyy', { locale: vi })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
