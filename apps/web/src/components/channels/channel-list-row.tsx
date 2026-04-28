'use client';

import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MoreVertical,
  PlugZap,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { ChannelStatus } from '@prisma/client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatCompact } from '@/lib/format';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import type { ChannelListItemFull } from '@/lib/types/channels-page';

const STATUS_BADGE: Record<ChannelStatus, string> = {
  ACTIVE:
    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  INACTIVE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  ARCHIVED: 'bg-muted text-muted-foreground border-muted-foreground/30',
};

const STATUS_ICON: Record<ChannelStatus, typeof CheckCircle2> = {
  ACTIVE: CheckCircle2,
  INACTIVE: AlertTriangle,
  ARCHIVED: PlugZap,
};

type Props = {
  channel: ChannelListItemFull;
  inProgress: boolean;
  onSync: (id: string) => void;
  onDisconnect: (channel: ChannelListItemFull) => void;
  onDelete: (channel: ChannelListItemFull) => void;
  syncPending: boolean;
};

export function ChannelListRow({
  channel,
  inProgress,
  onSync,
  onDisconnect,
  onDelete,
  syncPending,
}: Props) {
  const primary = channel.ownerships.find((o) => o.role === 'PRIMARY');
  const StatusIcon = STATUS_ICON[channel.status];

  const followers =
    channel.subscriberCount ??
    (channel.metadata?.subscriberCount as number | undefined) ??
    null;

  return (
    <tr className="transition-colors hover:bg-accent/40">
      <td className="px-3 py-2.5">
        <Link
          href={`/channels/${channel.id}`}
          className="group flex items-center gap-2"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={channel.thumbnailUrl ?? undefined} />
            <AvatarFallback className="text-[10px]">
              {channel.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium group-hover:underline">
              {channel.name}
            </div>
            {channel.externalUrl && (
              <div className="truncate text-xs text-muted-foreground">
                {channel.externalUrl.replace(/^https?:\/\//, '')}
              </div>
            )}
          </div>
        </Link>
      </td>

      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-xs">
          <span className={cn('h-2 w-2 rounded-full', PLATFORM_DOT[channel.platform])} />
          {PLATFORM_LABEL[channel.platform]}
        </div>
      </td>

      <td className="px-3 py-2.5">
        <Badge
          variant="outline"
          className={cn(
            'inline-flex items-center gap-1 text-[10px]',
            STATUS_BADGE[channel.status],
          )}
        >
          <StatusIcon className="h-2.5 w-2.5" />
          {channel.status}
        </Badge>
      </td>

      <td className="px-3 py-2.5">
        {primary ? (
          <Link
            href={`/employees/${primary.employeeId}`}
            className="flex items-center gap-1.5 text-xs hover:underline"
          >
            <Avatar className="h-5 w-5">
              <AvatarImage src={primary.avatar ?? undefined} />
              <AvatarFallback className="text-[8px]">
                {primary.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{primary.name}</span>
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">— Chưa gán —</span>
        )}
      </td>

      <td className="px-3 py-2.5">
        {channel.category ? (
          <Badge variant="secondary" className="text-[10px]">
            {channel.category}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      <td className="px-3 py-2.5 text-right tabular-nums">
        {followers !== null ? formatCompact(followers) : '—'}
      </td>

      <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
        {inProgress ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Đang sync
          </span>
        ) : channel.lastSyncedAt ? (
          <span title={format(new Date(channel.lastSyncedAt), 'dd/MM/yyyy HH:mm')}>
            {formatDistanceToNow(new Date(channel.lastSyncedAt), {
              addSuffix: true,
              locale: vi,
            })}
          </span>
        ) : (
          'Chưa sync'
        )}
      </td>

      <td className="px-3 py-2.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Hành động"
              title="Hành động"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onSync(channel.id)}
              disabled={syncPending || channel.status !== 'ACTIVE'}
            >
              <RefreshCw className={cn('h-4 w-4', syncPending && 'animate-spin')} />
              Sync ngay
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/channels/${channel.id}`}>
                <PlugZap className="h-4 w-4" />
                Chi tiết
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDisconnect(channel)}>
              <PlugZap className="h-4 w-4" />
              Disconnect
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(channel)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Xoá kênh
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
