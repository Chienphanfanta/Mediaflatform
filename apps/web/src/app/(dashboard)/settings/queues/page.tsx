// /settings/queues — SUPERADMIN-only queue monitor.
// Bull Board UI đầy đủ vẫn mount tại apps/api `/admin/queues` (basic auth env);
// page này là dashboard tổng hợp + retry/delete inline.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { ExternalLink, RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JobDetailDialog } from '@/components/admin/job-detail-dialog';

const QUEUE_NAMES = [
  'post-publisher',
  'analytics-sync',
  'alert-checker',
  'notification-sender',
] as const;
type QueueName = (typeof QUEUE_NAMES)[number];

const STATUSES = ['failed', 'active', 'waiting', 'completed', 'delayed'] as const;
type Status = (typeof STATUSES)[number];

type QueueStats = {
  name: QueueName;
  counts: Record<Status | 'paused', number>;
  recentCompleted24h: number;
  recentFailed24h: number;
  paused: boolean;
};

type JobSummary = {
  id: string;
  name: string;
  status: Status;
  data: unknown;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: string;
  durationMs: number | null;
  failedReason: string | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const REFRESH_INTERVAL_MS = 10_000;

export default function QueuesPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedQueue, setSelectedQueue] = useState<QueueName>('post-publisher');
  const [statusFilter, setStatusFilter] = useState<Status>('failed');
  const [page, setPage] = useState(1);
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  // Reset page khi đổi queue/status
  useEffect(() => setPage(1), [selectedQueue, statusFilter]);

  const refetchInterval = autoRefresh ? REFRESH_INTERVAL_MS : false;

  const stats = useQuery<QueueStats[]>({
    queryKey: ['queue-stats'],
    queryFn: async () => {
      const r = await fetch('/api/v1/admin/queues/stats');
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message);
      return j.data as QueueStats[];
    },
    refetchInterval,
  });

  const timeline = useQuery<{ hour: string; completed: number; failed: number }[]>({
    queryKey: ['queue-timeline'],
    queryFn: async () => {
      const r = await fetch('/api/v1/admin/queues/timeline');
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message);
      return j.data;
    },
    refetchInterval,
  });

  const jobs = useQuery<{ items: JobSummary[]; pagination: Pagination }>({
    queryKey: ['queue-jobs', selectedQueue, statusFilter, page],
    queryFn: async () => {
      const r = await fetch(
        `/api/v1/admin/queues/${selectedQueue}/jobs?status=${statusFilter}&page=${page}&pageSize=20`,
      );
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message);
      return {
        items: j.data as JobSummary[],
        pagination: j.meta?.pagination as Pagination,
      };
    },
    refetchInterval,
  });

  const chartData = useMemo(
    () =>
      (timeline.data ?? []).map((b) => ({
        hour: format(new Date(b.hour), 'HH'),
        fullHour: format(new Date(b.hour), 'HH:mm dd/MM'),
        completed: b.completed,
        failed: b.failed,
      })),
    [timeline.data],
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Queue Monitor</h1>
          <p className="text-sm text-muted-foreground">
            BullMQ stats real-time · 24h timeline từ JobLog
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-4 w-4"
            />
            Auto-refresh 10s
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              stats.refetch();
              timeline.refetch();
              jobs.refetch();
            }}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a
              // Bull Board mount ở apps/api `:4000/admin/queues` (basic auth qua
              // BULL_BOARD_USER/BULL_BOARD_PASS env). NEXT_PUBLIC_API_URL trỏ
              // tới NestJS instance — production set qua env.
              href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/admin/queues`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Bull Board
            </a>
          </Button>
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(stats.data ?? []).map((q) => (
          <QueueCard
            key={q.name}
            stats={q}
            active={selectedQueue === q.name}
            onClick={() => setSelectedQueue(q.name)}
          />
        ))}
        {stats.isLoading &&
          QUEUE_NAMES.map((n) => (
            <Card key={n}>
              <CardContent className="py-8 text-center text-xs text-muted-foreground">
                Đang tải {n}...
              </CardContent>
            </Card>
          ))}
      </div>

      {/* Timeline chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">24h timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="hour" tickLine={false} fontSize={11} />
                <YAxis tickLine={false} fontSize={11} allowDecimals={false} />
                <Tooltip
                  formatter={(v: number, name: string) => [v, name]}
                  labelFormatter={(_label, payload) =>
                    payload?.[0]?.payload?.fullHour ?? ''
                  }
                  contentStyle={{
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend />
                <Bar dataKey="completed" fill="#10B981" name="Completed" />
                <Bar dataKey="failed" fill="#EF4444" name="Failed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Job list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">
            Jobs · <span className="text-muted-foreground">{selectedQueue}</span>
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? 'default' : 'outline'}
                onClick={() => setStatusFilter(s)}
                className="h-7 text-xs"
              >
                {s}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <JobsTable
            data={jobs.data?.items ?? []}
            loading={jobs.isLoading}
            onOpen={setOpenJobId}
          />
          {jobs.data && jobs.data.pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t pt-4">
              <span className="text-xs text-muted-foreground">
                Trang {jobs.data.pagination.page}/{jobs.data.pagination.totalPages} ·{' '}
                {jobs.data.pagination.total} jobs
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Trước
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= jobs.data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sau
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <JobDetailDialog
        queueName={selectedQueue}
        jobId={openJobId}
        open={!!openJobId}
        onOpenChange={(o) => !o && setOpenJobId(null)}
      />
    </div>
  );
}

function QueueCard({
  stats,
  active,
  onClick,
}: {
  stats: QueueStats;
  active: boolean;
  onClick: () => void;
}) {
  const failed24h = stats.recentFailed24h;
  const tone =
    failed24h === 0
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : failed24h < 10
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-destructive/50 bg-destructive/5';

  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer transition-all hover:shadow-md ${tone} ${
        active ? 'ring-2 ring-foreground/40' : ''
      }`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span className="truncate">{stats.name}</span>
          {stats.paused && (
            <Badge variant="secondary" className="text-xs">
              paused
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <Stat label="Active" value={stats.counts.active} />
        <Stat label="Waiting" value={stats.counts.waiting} />
        <Stat
          label="Completed (24h)"
          value={stats.recentCompleted24h}
          accent="emerald"
        />
        <Stat
          label="Failed (24h)"
          value={stats.recentFailed24h}
          accent={failed24h > 0 ? 'destructive' : undefined}
        />
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'emerald' | 'destructive';
}) {
  const valueColor =
    accent === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : accent === 'destructive'
        ? 'text-destructive'
        : '';
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-semibold tabular-nums ${valueColor}`}>
        {value.toLocaleString('vi-VN')}
      </span>
    </div>
  );
}

function JobsTable({
  data,
  loading,
  onOpen,
}: {
  data: JobSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (loading) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        Đang tải...
      </p>
    );
  }
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        Không có job ở trạng thái này.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-2 py-2 font-medium">Job ID</th>
            <th className="px-2 py-2 font-medium">Type</th>
            <th className="px-2 py-2 font-medium">Data</th>
            <th className="px-2 py-2 font-medium">Created</th>
            <th className="px-2 py-2 font-medium">Duration</th>
            <th className="px-2 py-2 font-medium">Attempts</th>
          </tr>
        </thead>
        <tbody>
          {data.map((j) => (
            <tr
              key={j.id}
              onClick={() => onOpen(j.id)}
              className="cursor-pointer border-b border-muted/40 transition-colors hover:bg-muted/30"
            >
              <td className="px-2 py-2 font-mono text-xs">{j.id}</td>
              <td className="px-2 py-2 text-xs">{j.name}</td>
              <td className="max-w-[280px] truncate px-2 py-2 font-mono text-xs text-muted-foreground">
                {previewData(j.data)}
              </td>
              <td className="px-2 py-2 text-xs text-muted-foreground">
                {format(new Date(j.createdAt), 'HH:mm dd/MM', { locale: vi })}
              </td>
              <td className="px-2 py-2 font-mono text-xs">
                {j.durationMs !== null ? `${j.durationMs}ms` : '—'}
              </td>
              <td className="px-2 py-2 text-xs">
                <span
                  className={
                    j.attemptsMade >= j.maxAttempts ? 'text-destructive' : ''
                  }
                >
                  {j.attemptsMade}/{j.maxAttempts}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function previewData(data: unknown): string {
  try {
    const s = JSON.stringify(data);
    return s.length > 120 ? s.slice(0, 120) + '...' : s;
  } catch {
    return '[unserializable]';
  }
}
