'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  Loader2,
  MoreVertical,
  Pencil,
  PlugZap,
  RefreshCw,
  Trash2,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';
import type { ChannelStatus } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
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
import type { ChannelListItemFull, SyncInProgressItem } from '@/lib/types/channels-page';

const STATUS_META: Record<
  ChannelStatus,
  {
    label: string;
    badge: string;
    border: string;
    Icon: typeof CheckCircle2;
  }
> = {
  ACTIVE: {
    label: 'Connected',
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    border: 'border-emerald-500/40',
    Icon: CheckCircle2,
  },
  TOKEN_EXPIRED: {
    label: 'Token Expired',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    border: 'border-amber-500/40',
    Icon: AlertTriangle,
  },
  SUSPENDED: {
    label: 'Suspended',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    border: 'border-amber-500/40',
    Icon: AlertTriangle,
  },
  DISCONNECTED: {
    label: 'Disconnected',
    badge: 'bg-muted text-muted-foreground border-muted-foreground/30',
    border: 'border-muted',
    Icon: PlugZap,
  },
  ERROR: {
    label: 'Error',
    badge: 'bg-destructive/10 text-destructive border-destructive/30',
    border: 'border-destructive/40',
    Icon: XCircle,
  },
};

type Props = {
  channel: ChannelListItemFull;
  inProgress?: SyncInProgressItem;
  onSync: (id: string) => void;
  onDisconnect: (channel: ChannelListItemFull) => void;
  onDelete: (channel: ChannelListItemFull) => void;
  syncPending?: boolean;
};

export function ChannelCard({
  channel,
  inProgress,
  onSync,
  onDisconnect,
  onDelete,
  syncPending,
}: Props) {
  const status = STATUS_META[channel.status];
  const isSyncing = !!inProgress || syncPending;

  return (
    <Card className={cn('flex flex-col border', status.border)}>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white',
            PLATFORM_DOT[channel.platform],
          )}
        >
          {PLATFORM_LABEL[channel.platform][0]}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{channel.name}</h3>
          <div className="mt-0.5 flex items-center gap-2">
            <Badge variant="outline" className={cn('h-5 border text-[10px]', status.badge)}>
              <status.Icon className="mr-1 h-3 w-3" />
              {status.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {PLATFORM_LABEL[channel.platform]}
            </span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Tuỳ chọn</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled>
              <Pencil className="mr-2 h-4 w-4" />
              Chỉnh sửa
              <span className="ml-auto text-[10px] text-muted-foreground">P1</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDisconnect(channel)}>
              <PlugZap className="mr-2 h-4 w-4" />
              Ngắt kết nối
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(channel)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Xoá kênh
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        {/* Avatar + subscriber count */}
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 overflow-hidden rounded-full bg-muted">
            {channel.thumbnailUrl ? (
              <Image
                src={channel.thumbnailUrl}
                alt={channel.name}
                fill
                sizes="48px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-muted-foreground">
                {channel.name[0]?.toUpperCase() ?? '?'}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-sm font-semibold">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              {channel.subscriberCount !== null
                ? formatCompact(channel.subscriberCount)
                : '—'}
            </div>
            <p className="text-[10px] text-muted-foreground">subscribers</p>
          </div>
        </div>

        {/* Monthly stats */}
        <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/30 p-2">
          <Stat
            icon={Eye}
            label="View tháng này"
            value={formatCompact(channel.monthStats.views)}
          />
          <Stat
            icon={TrendingUp}
            label="Watch h tháng này"
            value={String(Math.round(channel.monthStats.watchTimeHours))}
          />
        </div>

        {/* Group + last sync */}
        <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
          {channel.groupNames.slice(0, 2).map((g) => (
            <span key={g} className="rounded bg-muted px-1.5 py-0.5">
              {g}
            </span>
          ))}
          {channel.groupNames.length > 2 && (
            <span className="text-muted-foreground/70">
              +{channel.groupNames.length - 2}
            </span>
          )}
        </div>
        {channel.lastSyncedAt && !isSyncing && (
          <p className="text-[10px] text-muted-foreground">
            Sync lần cuối:{' '}
            {formatDistanceToNow(parseISO(channel.lastSyncedAt), {
              addSuffix: true,
              locale: vi,
            })}
          </p>
        )}
        {isSyncing && (
          <p className="flex items-center gap-1 text-[10px] text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            Đang sync...
          </p>
        )}
      </CardContent>

      <CardFooter className="gap-2 pt-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSync(channel.id)}
          disabled={isSyncing || channel.status === 'TOKEN_EXPIRED'}
          title={
            channel.status === 'TOKEN_EXPIRED' ? 'Reconnect kênh trước khi sync' : ''
          }
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
          Sync
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/analytics/channels/${channel.id}`}>
            <ExternalLink className="h-3.5 w-3.5" />
            Chi tiết
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

// Placeholder export to satisfy unused import linting
void useState;
