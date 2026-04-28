'use client';

import Image from 'next/image';
import Link from 'next/link';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  Archive,
  ArrowLeftRight,
  ExternalLink,
  Loader2,
  MoreVertical,
  Pencil,
  PlugZap,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import type { ChannelStatus } from '@prisma/client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { useArchiveChannel } from '@/hooks/use-channels-list';
import { cn } from '@/lib/utils';
import { formatCompact } from '@/lib/format';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import type {
  ChannelListItemFull,
  ChannelOwnershipBrief,
  SyncInProgressItem,
} from '@/lib/types/channels-page';

const STATUS_BADGE: Record<ChannelStatus, string> = {
  ACTIVE:
    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  INACTIVE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  ARCHIVED: 'bg-muted text-muted-foreground border-muted-foreground/30',
};

// Sync indicator: green = ACTIVE + recent sync, yellow = stale/error, red = INACTIVE/ARCHIVED
function syncIndicatorColor(channel: ChannelListItemFull): string {
  if (channel.status !== 'ACTIVE') return 'bg-destructive';
  if (channel.lastSyncError) return 'bg-amber-500';
  if (channel.lastSyncedAt) {
    const ageMs = Date.now() - new Date(channel.lastSyncedAt).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) return 'bg-amber-500'; // > 24h = stale
    return 'bg-emerald-500';
  }
  return 'bg-amber-500';
}

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
  const isSyncing = !!inProgress || syncPending;
  const archive = useArchiveChannel();

  const primary = channel.ownerships.find((o) => o.role === 'PRIMARY');
  const secondaries = channel.ownerships.filter((o) => o.role === 'SECONDARY');

  const followers =
    channel.subscriberCount ??
    (channel.metadata?.subscriberCount as number | undefined) ??
    null;
  const delta = channel.monthStats.subscriberDelta;
  const dotColor = syncIndicatorColor(channel);

  const handleArchive = () => {
    if (!confirm(`Archive kênh "${channel.name}"? Channel sẽ không còn trong list ACTIVE.`)) {
      return;
    }
    archive.mutate(channel.id);
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white',
            PLATFORM_DOT[channel.platform],
          )}
          aria-label={PLATFORM_LABEL[channel.platform]}
        >
          {PLATFORM_LABEL[channel.platform][0]}
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={`/channels/${channel.id}`}
            className="block truncate text-sm font-semibold hover:underline"
          >
            {channel.name}
          </Link>
          <div className="mt-0.5 flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn('h-5 border text-[10px]', STATUS_BADGE[channel.status])}
            >
              {channel.status}
            </Badge>
            {channel.category && (
              <Badge variant="secondary" className="h-5 text-[10px]">
                {channel.category}
              </Badge>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Tuỳ chọn kênh"
              title="Tuỳ chọn"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onClick={() => onSync(channel.id)}
              disabled={isSyncing || channel.status !== 'ACTIVE'}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', isSyncing && 'animate-spin')} />
              Sync ngay
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/channels/${channel.id}?edit=1`}>
                <Pencil className="mr-2 h-4 w-4" />
                Chỉnh sửa
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/channels/${channel.id}?action=transfer`}>
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                Transfer owner
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleArchive}
              disabled={channel.status === 'ARCHIVED' || archive.isPending}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDisconnect(channel)}>
              <PlugZap className="mr-2 h-4 w-4" />
              Disconnect
            </DropdownMenuItem>
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

      <CardContent className="flex-1 space-y-3 pb-3">
        {/* Avatar + followers + delta */}
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
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
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold tabular-nums">
                {followers !== null ? formatCompact(followers) : '—'}
              </span>
              {delta !== 0 && (
                <span
                  className={cn(
                    'text-xs font-medium tabular-nums',
                    delta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-destructive',
                  )}
                >
                  {delta > 0 ? '+' : ''}
                  {formatCompact(delta)}
                </span>
              )}
            </div>
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Users className="h-2.5 w-2.5" />
              followers · Δ tháng này
            </p>
          </div>
        </div>

        {/* PRIMARY owner */}
        {primary ? (
          <Link
            href={`/employees/${primary.employeeId}`}
            className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs transition-colors hover:bg-accent"
          >
            <Avatar className="h-6 w-6">
              <AvatarImage src={primary.avatar ?? undefined} />
              <AvatarFallback className="text-[9px]">
                {primary.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{primary.name}</div>
              <div className="text-[10px] text-muted-foreground">PRIMARY owner</div>
            </div>
          </Link>
        ) : (
          <div className="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
            Chưa có PRIMARY owner
          </div>
        )}

        {/* SECONDARY owners avatar group */}
        {secondaries.length > 0 && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Hỗ trợ:</span>
            <SecondaryAvatarGroup owners={secondaries} />
          </div>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-2 border-t pt-3">
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
          <span
            className={cn('h-2 w-2 shrink-0 rounded-full', dotColor)}
            title={
              channel.lastSyncError ?? `Sync status: ${channel.status.toLowerCase()}`
            }
            aria-label="Sync status indicator"
          />
          <span className="truncate">
            {isSyncing ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                Đang sync...
              </span>
            ) : channel.lastSyncedAt ? (
              <span title={format(parseISO(channel.lastSyncedAt), 'dd/MM/yyyy HH:mm')}>
                Sync{' '}
                {formatDistanceToNow(parseISO(channel.lastSyncedAt), {
                  addSuffix: true,
                  locale: vi,
                })}
              </span>
            ) : (
              'Chưa sync lần nào'
            )}
          </span>
        </div>
        <Button asChild variant="outline" size="sm" className="h-7 text-xs">
          <Link href={`/channels/${channel.id}`}>
            <ExternalLink className="h-3 w-3" />
            Chi tiết
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function SecondaryAvatarGroup({ owners }: { owners: ChannelOwnershipBrief[] }) {
  const visible = owners.slice(0, 3);
  const extra = owners.length - visible.length;

  return (
    <div className="flex -space-x-1.5">
      {visible.map((o) => (
        <Link
          key={o.employeeId}
          href={`/employees/${o.employeeId}`}
          title={`${o.name} · SECONDARY`}
        >
          <Avatar className="h-5 w-5 border-2 border-card">
            <AvatarImage src={o.avatar ?? undefined} />
            <AvatarFallback className="text-[8px]">
              {o.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>
      ))}
      {extra > 0 && (
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-muted text-[8px] font-medium"
          title={`+${extra} secondary owners`}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
