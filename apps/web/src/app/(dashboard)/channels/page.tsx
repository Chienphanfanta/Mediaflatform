'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Plus,
  PanelRightClose,
  PanelRightOpen,
  Tv,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/hooks/use-permission';
import {
  useChannelsList,
  useDeleteChannel,
  useDisconnectChannel,
  useSyncAllChannels,
  useSyncChannel,
} from '@/hooks/use-channels-list';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { ChannelCard } from '@/components/channels/channel-card';
import { ChannelListRow } from '@/components/channels/channel-list-row';
import {
  ChannelFiltersBar,
  type ChannelFilters,
  type ChannelView,
} from '@/components/channels/channel-filters';
import { AddChannelDialog } from '@/components/channels/add-channel-dialog';
import { SyncStatusPanel } from '@/components/channels/sync-status-panel';
import type { ChannelListItemFull } from '@/lib/types/channels-page';

const DEFAULT_FILTERS: ChannelFilters = {
  platforms: [],
  category: 'all',
  primaryOwnerId: 'all',
  status: 'all',
  query: '',
};

export default function ChannelsPage() {
  const { atLeast } = usePermission();

  const [filters, setFilters] = useState<ChannelFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<ChannelView>('grid');
  const [panelOpen, setPanelOpen] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const { data: channels, isLoading, isError, error } = useChannelsList();
  const {
    data: syncStatus,
    isLoading: statusLoading,
    isFetching: statusFetching,
  } = useSyncStatus();

  const syncOne = useSyncChannel();
  const syncAll = useSyncAllChannels();
  const disconnect = useDisconnectChannel();
  const remove = useDeleteChannel();

  // Build filter dropdown options từ data hiện có
  const categories = useMemo(() => {
    if (!channels) return [];
    const set = new Set<string>();
    for (const c of channels) {
      if (c.category) set.add(c.category);
    }
    return Array.from(set).sort();
  }, [channels]);

  const primaryOwners = useMemo(() => {
    if (!channels) return [];
    const map = new Map<string, string>();
    for (const c of channels) {
      const primary = c.ownerships.find((o) => o.role === 'PRIMARY');
      if (primary) map.set(primary.employeeId, primary.name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [channels]);

  const filtered = useMemo(() => {
    if (!channels) return [];
    const q = filters.query.trim().toLowerCase();
    return channels.filter((c) => {
      if (filters.platforms.length > 0 && !filters.platforms.includes(c.platform)) {
        return false;
      }
      if (filters.category !== 'all' && c.category !== filters.category) {
        return false;
      }
      if (filters.status !== 'all' && c.status !== filters.status) {
        return false;
      }
      if (filters.primaryOwnerId !== 'all') {
        const primary = c.ownerships.find((o) => o.role === 'PRIMARY');
        if (!primary || primary.employeeId !== filters.primaryOwnerId) {
          return false;
        }
      }
      if (q) {
        const haystack = [
          c.name,
          c.externalUrl ?? '',
          c.accountId,
          c.description ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [channels, filters]);

  const inProgressMap = useMemo(() => {
    const m = new Map<string, NonNullable<typeof syncStatus>['inProgress'][number]>();
    syncStatus?.inProgress.forEach((it) => m.set(it.channelId, it));
    return m;
  }, [syncStatus]);

  const handleSync = (id: string) => {
    setSyncingId(id);
    syncOne.mutate(id, { onSettled: () => setSyncingId(null) });
  };

  const handleDisconnect = (channel: ChannelListItemFull) => {
    if (!confirm(`Ngắt kết nối "${channel.name}"? Token sẽ bị revoke tại provider.`)) {
      return;
    }
    disconnect.mutate({ platform: channel.platform, channelId: channel.id });
  };

  const handleDelete = (channel: ChannelListItemFull) => {
    if (
      !confirm(
        `Xoá kênh "${channel.name}"? Channel sẽ bị soft-delete (history giữ lại). Để khôi phục cần admin DB.`,
      )
    ) {
      return;
    }
    remove.mutate(channel.id);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Tv className="h-7 w-7" />
            Kênh truyền thông
            {channels && (
              <span className="text-sm font-normal text-muted-foreground">
                ({channels.length})
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quản lý kết nối, sync analytics và monitor token expiry tất cả nền tảng.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPanelOpen((o) => !o)}
            aria-label={panelOpen ? 'Ẩn sync panel' : 'Mở sync panel'}
            title={panelOpen ? 'Ẩn panel' : 'Mở panel'}
          >
            {panelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
          {atLeast('MANAGER') && (
            <Button onClick={() => setConnectOpen(true)}>
              <Plus className="h-4 w-4" />
              Thêm kênh mới
            </Button>
          )}
        </div>
      </header>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được danh sách kênh</AlertTitle>
          <AlertDescription>{error?.message ?? 'Lỗi không xác định.'}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <ChannelFiltersBar
            filters={filters}
            onChange={setFilters}
            view={view}
            onViewChange={setView}
            categories={categories}
            primaryOwners={primaryOwners}
            totalCount={channels?.length ?? 0}
          />

          {isLoading ? (
            view === 'grid' ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-72 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-md" />
                ))}
              </div>
            )
          ) : filtered.length === 0 ? (
            <EmptyState
              hasChannels={(channels?.length ?? 0) > 0}
              canConnect={atLeast('MANAGER')}
              onConnect={() => setConnectOpen(true)}
            />
          ) : view === 'grid' ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((c) => (
                <ChannelCard
                  key={c.id}
                  channel={c}
                  inProgress={inProgressMap.get(c.id)}
                  onSync={handleSync}
                  onDisconnect={handleDisconnect}
                  onDelete={handleDelete}
                  syncPending={syncingId === c.id && syncOne.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Kênh</th>
                    <th className="px-3 py-2 font-medium">Platform</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">PRIMARY owner</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 text-right font-medium">Followers</th>
                    <th className="px-3 py-2 text-right font-medium">Last sync</th>
                    <th className="w-10 px-3 py-2">
                      <span className="sr-only">Hành động</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((c) => (
                    <ChannelListRow
                      key={c.id}
                      channel={c}
                      inProgress={!!inProgressMap.get(c.id)}
                      onSync={handleSync}
                      onDisconnect={handleDisconnect}
                      onDelete={handleDelete}
                      syncPending={syncingId === c.id && syncOne.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {panelOpen && (
          <aside className="w-full lg:w-80 lg:shrink-0">
            <SyncStatusPanel
              status={syncStatus}
              isLoading={statusLoading}
              isFetching={statusFetching}
              onSyncAll={() => syncAll.mutate()}
              syncAllPending={syncAll.isPending}
              onClose={() => setPanelOpen(false)}
            />
          </aside>
        )}
      </div>

      <AddChannelDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
      />
    </div>
  );
}

function EmptyState({
  hasChannels,
  canConnect,
  onConnect,
}: {
  hasChannels: boolean;
  canConnect: boolean;
  onConnect: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
        <Tv className="h-10 w-10 text-muted-foreground/50" />
        {hasChannels ? (
          <>
            <p className="text-sm font-medium">Không khớp filter</p>
            <p className="text-xs text-muted-foreground">
              Thử điều chỉnh filter hoặc xoá để xem tất cả.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Chưa có kênh nào</p>
            <p className="text-xs text-muted-foreground">
              {canConnect
                ? 'Kết nối kênh đầu tiên để bắt đầu theo dõi analytics.'
                : 'Liên hệ Manager để kết nối kênh.'}
            </p>
            {canConnect && (
              <Button className="mt-2" onClick={onConnect}>
                <Plus className="h-4 w-4" />
                Thêm kênh mới
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
