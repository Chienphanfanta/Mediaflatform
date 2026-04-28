// /channels/[id] — Channel management detail page.
// Step 4.4: header + tabs scaffold. Step 4.5 sẽ wire content cho từng tab.
'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { TabGrowth } from '@/components/channels/tabs/tab-growth';
import { TabKpi } from '@/components/channels/tabs/tab-kpi';
import { TabOverview } from '@/components/channels/tabs/tab-overview';
import { TabOwners } from '@/components/channels/tabs/tab-owners';
import { TabSyncLogs } from '@/components/channels/tabs/tab-sync-logs';
import { useChannelManagement } from '@/hooks/use-channel-management';
import {
  useArchiveChannel,
  useSyncChannel,
} from '@/hooks/use-channels-list';
import { cn } from '@/lib/utils';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import type {
  ChannelDetailV2,
  ChannelOwnershipDetail,
} from '@/lib/types/channel-management';
import type { ChannelStatus } from '@prisma/client';

const STATUS_BADGE: Record<ChannelStatus, string> = {
  ACTIVE:
    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  INACTIVE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  ARCHIVED: 'bg-muted text-muted-foreground border-muted-foreground/30',
};

export default function ChannelDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const channelId = params?.id ?? '';
  const initialTab = search?.get('tab') ?? 'overview';

  const { data, isLoading, isError, error } = useChannelManagement(channelId);

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/channels">
          <ArrowLeft className="h-4 w-4" />
          Quay lại danh sách kênh
        </Link>
      </Button>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được kênh</AlertTitle>
          <AlertDescription>
            {error?.message ?? 'Lỗi không xác định.'}
          </AlertDescription>
        </Alert>
      ) : isLoading || !data ? (
        <ChannelDetailSkeleton />
      ) : (
        <>
          <ChannelHeader channel={data} />

          <Tabs defaultValue={initialTab} className="space-y-3">
            <TabsList className="w-full justify-start sm:w-auto">
              <TabsTrigger value="overview">Tổng quan</TabsTrigger>
              <TabsTrigger value="growth">Tăng trưởng</TabsTrigger>
              <TabsTrigger value="kpi">KPI</TabsTrigger>
              <TabsTrigger value="owners">Lịch sử owners</TabsTrigger>
              <TabsTrigger value="sync-logs">Sync logs</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <TabOverview channelId={data.id} />
            </TabsContent>

            <TabsContent value="growth">
              <TabGrowth channelId={data.id} />
            </TabsContent>

            <TabsContent value="kpi">
              <TabKpi />
            </TabsContent>

            <TabsContent value="owners">
              <TabOwners ownerships={data.ownerships} />
            </TabsContent>

            <TabsContent value="sync-logs">
              <TabSyncLogs channelId={data.id} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// ────────── Header ──────────

function ChannelHeader({ channel }: { channel: ChannelDetailV2 }) {
  const router = useRouter();
  const sync = useSyncChannel();
  const archive = useArchiveChannel();

  const primary = channel.ownerships.find((o) => o.role === 'PRIMARY');
  const secondaries = channel.ownerships.filter((o) => o.role === 'SECONDARY');

  const handleSync = () => sync.mutate(channel.id);
  const handleArchive = () => {
    if (!confirm(`Archive kênh "${channel.name}"?`)) return;
    archive.mutate(channel.id, {
      onSuccess: () => router.refresh(),
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        {/* Top row: platform icon + name + status + actions */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-lg font-bold text-white',
                PLATFORM_DOT[channel.platform],
              )}
              aria-label={PLATFORM_LABEL[channel.platform]}
            >
              {PLATFORM_LABEL[channel.platform][0]}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
                {channel.name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn('text-xs', STATUS_BADGE[channel.status])}
                >
                  {channel.status}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {PLATFORM_LABEL[channel.platform]}
                </Badge>
                {channel.category && (
                  <Badge variant="secondary" className="text-xs">
                    {channel.category}
                  </Badge>
                )}
                {channel.externalUrl && (
                  <a
                    href={channel.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {channel.externalUrl.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={sync.isPending || channel.status !== 'ACTIVE'}
              title={
                channel.status !== 'ACTIVE'
                  ? 'Chỉ ACTIVE channel mới sync được'
                  : ''
              }
            >
              {sync.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync now
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/channels/${channel.id}?edit=1`}>
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleArchive}
              disabled={archive.isPending || channel.status === 'ARCHIVED'}
            >
              <Archive className="h-4 w-4" />
              Archive
            </Button>
          </div>
        </div>

        {channel.description && (
          <p className="text-sm text-muted-foreground">{channel.description}</p>
        )}

        {/* Owner info */}
        <div className="grid gap-3 sm:grid-cols-2">
          <OwnerSlot label="PRIMARY owner" owner={primary} />
          <SecondaryList owners={secondaries} />
        </div>

        {/* Footer: groups + last sync */}
        <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-xs text-muted-foreground">
          {channel.groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span>Groups:</span>
              {channel.groups.map((g) => (
                <Badge key={g.id} variant="outline" className="text-[10px]">
                  {g.name}
                </Badge>
              ))}
            </div>
          )}
          {channel.lastSyncedAt && (
            <span>
              Sync gần nhất:{' '}
              {format(new Date(channel.lastSyncedAt), 'dd/MM/yyyy HH:mm', {
                locale: vi,
              })}
            </span>
          )}
          {channel.lastSyncError && (
            <span className="text-amber-600 dark:text-amber-400">
              ⚠ {channel.lastSyncError}
            </span>
          )}
          <span className="ml-auto">
            Created:{' '}
            {format(new Date(channel.createdAt), 'dd/MM/yyyy', { locale: vi })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function OwnerSlot({
  label,
  owner,
}: {
  label: string;
  owner: ChannelOwnershipDetail | undefined;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {owner ? (
        <Link
          href={`/hr/${owner.employeeId}`}
          className="flex items-center gap-2 hover:underline"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={owner.avatar ?? undefined} />
            <AvatarFallback className="text-xs">
              {owner.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{owner.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {owner.email}
            </div>
          </div>
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">— Chưa gán —</p>
      )}
    </div>
  );
}

function SecondaryList({ owners }: { owners: ChannelOwnershipDetail[] }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        SECONDARY owners ({owners.length})
      </p>
      {owners.length === 0 ? (
        <p className="text-sm text-muted-foreground">— Không có —</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {owners.map((o) => (
            <Link
              key={o.employeeId}
              href={`/hr/${o.employeeId}`}
              className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent"
              title={o.email}
            >
              <Avatar className="h-5 w-5">
                <AvatarImage src={o.avatar ?? undefined} />
                <AvatarFallback className="text-[8px]">
                  {o.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {o.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────── Skeleton ──────────

function ChannelDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
