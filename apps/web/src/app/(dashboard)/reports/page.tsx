'use client';

import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertCircle,
  Download,
  FileText,
  Loader2,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ApiClientError } from '@/lib/api-client';
import { formatCompact } from '@/lib/format';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import { usePermission } from '@/hooks/use-permission';
import { useChannels } from '@/hooks/use-channels';
import { useReportHistory } from '@/hooks/use-report-history';
import type {
  ReportData,
  ReportFormat,
  ReportInput,
  ReportPeriod,
  ReportType,
} from '@/lib/types/reports';

const TYPE_LABEL: Record<ReportType, string> = {
  CHANNEL: 'Hiệu suất Kênh',
  HR: 'Hoạt động Nhân sự',
};

const TYPE_DESC: Record<ReportType, string> = {
  CHANNEL: 'Metrics theo kênh + growth summary',
  HR: 'Danh sách nhân sự theo group',
};

const PERIODS: Array<{ key: ReportPeriod; label: string }> = [
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: '90d', label: '90 ngày' },
  { key: 'custom', label: 'Tuỳ chỉnh' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const { atLeast, user } = usePermission();
  const { data: channels = [] } = useChannels();
  const { history, add: addHistory, clear: clearHistory } = useReportHistory();

  const [type, setType] = useState<ReportType>('CHANNEL');
  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const [from, setFrom] = useState(daysAgoISO(13));
  const [to, setTo] = useState(todayISO());
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [selectedGroup, setSelectedGroup] = useState<string>('');

  const [preview, setPreview] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState<null | 'preview' | 'csv' | 'pdf'>(null);
  const [error, setError] = useState<string | null>(null);
  // Track last attempted format → "Thử lại" button trong error Alert biết retry cái nào
  const [lastFormat, setLastFormat] = useState<ReportFormat | null>(null);

  const userGroups = user?.groups ?? [];

  // Permission gate
  if (!atLeast('MANAGER')) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium">Tính năng giới hạn</p>
          <p className="text-xs text-muted-foreground">
            Tạo báo cáo yêu cầu quyền <strong>Manager</strong> trở lên.
          </p>
        </CardContent>
      </Card>
    );
  }

  const buildInput = (format: ReportFormat): ReportInput => ({
    type,
    period,
    from: period === 'custom' ? new Date(from).toISOString() : undefined,
    to: period === 'custom' ? new Date(to).toISOString() : undefined,
    channelIds:
      type === 'CHANNEL' && selectedChannels.size > 0
        ? Array.from(selectedChannels)
        : undefined,
    groupId: type === 'HR' && selectedGroup ? selectedGroup : undefined,
    format,
  });

  const scopeLabel = useMemo(() => {
    if (type === 'HR') {
      const g = userGroups.find((g) => g.id === selectedGroup);
      return g ? `Group: ${g.name}` : 'Tất cả groups';
    }
    if (selectedChannels.size > 0) return `${selectedChannels.size} kênh`;
    return 'Tất cả kênh';
  }, [type, selectedGroup, selectedChannels, userGroups]);

  // ─── Actions ───
  async function fetchReport(format: ReportFormat) {
    setError(null);
    setLastFormat(format);
    setLoading(format === 'JSON' ? 'preview' : format === 'CSV' ? 'csv' : 'pdf');
    try {
      const res = await fetch('/api/v1/reports/generate', {
        method: 'POST',
        body: JSON.stringify(buildInput(format)),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (format === 'JSON') {
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new ApiClientError(
            json.error?.code ?? 'ERROR',
            json.error?.message ?? `HTTP ${res.status}`,
            res.status,
            json.error?.details,
          );
        }
        setPreview(json.data as ReportData);
      } else {
        if (!res.ok) {
          // Server returned JSON error envelope
          const json = await res.json().catch(() => null);
          throw new Error(
            json?.error?.message ?? `Tải ${format} thất bại (HTTP ${res.status})`,
          );
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().slice(0, 10);
        a.download = `report-${type.toLowerCase()}-${stamp}.${format.toLowerCase()}`;
        a.click();
        URL.revokeObjectURL(url);

        addHistory({ type, period, format, scopeLabel });
      }
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Lỗi không xác định',
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <FileText className="h-7 w-7" />
          Báo cáo
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tạo và xuất báo cáo theo kênh, nhân sự hoặc lịch nội dung.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Form */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Loại báo cáo</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(TYPE_LABEL) as ReportType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setType(t);
                    setPreview(null);
                  }}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    type === t
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-primary/50 hover:bg-accent/30',
                  )}
                >
                  <div className="text-sm font-semibold">{TYPE_LABEL[t]}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{TYPE_DESC[t]}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Khoảng thời gian</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPeriod(p.key)}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-sm transition-colors',
                      period === p.key
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {period === 'custom' && (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    className="h-9 w-[160px]"
                    value={from}
                    max={to}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                  <span className="text-muted-foreground">→</span>
                  <Input
                    type="date"
                    className="h-9 w-[160px]"
                    value={to}
                    min={from}
                    max={todayISO()}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Phạm vi</CardTitle>
            </CardHeader>
            <CardContent>
              {type === 'HR' ? (
                <div className="space-y-2">
                  <Label htmlFor="hr-group">Group (để trống = tất cả groups)</Label>
                  <select
                    id="hr-group"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                  >
                    <option value="">— Tất cả —</option>
                    {userGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.role})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Kênh ({selectedChannels.size || 'tất cả'})</Label>
                  <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-2">
                    {channels.length === 0 ? (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        Chưa có kênh nào.
                      </p>
                    ) : (
                      channels.map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-accent"
                        >
                          <Checkbox
                            checked={selectedChannels.has(c.id)}
                            onCheckedChange={(checked) => {
                              setSelectedChannels((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(c.id);
                                else next.delete(c.id);
                                return next;
                              });
                            }}
                          />
                          <span
                            className={cn(
                              'h-2 w-2 rounded-full',
                              PLATFORM_DOT[c.platform as keyof typeof PLATFORM_DOT] ?? 'bg-muted',
                            )}
                          />
                          <span className="flex-1 truncate text-sm">{c.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {PLATFORM_LABEL[c.platform as keyof typeof PLATFORM_LABEL] ?? c.platform}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Bỏ chọn tất cả = báo cáo trên toàn bộ kênh user có quyền.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Tạo báo cáo thất bại</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span>{error}</span>
                {lastFormat && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading !== null}
                    onClick={() => fetchReport(lastFormat)}
                  >
                    Thử lại {lastFormat}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => fetchReport('JSON')}
              disabled={loading !== null}
            >
              {loading === 'preview' && <Loader2 className="h-4 w-4 animate-spin" />}
              Xem preview
            </Button>
            <Button onClick={() => fetchReport('PDF')} disabled={loading !== null}>
              {loading === 'pdf' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => fetchReport('CSV')}
              disabled={loading !== null}
            >
              {loading === 'csv' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download CSV
            </Button>
          </div>

          {preview && <ReportPreview data={preview} />}
        </div>

        {/* History */}
        <div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Lịch sử (tối đa 10)</CardTitle>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                  Xoá
                </button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Chưa có báo cáo nào trong session này.
                  <br />
                  <span className="text-xs">(Lưu trong localStorage trình duyệt)</span>
                </p>
              ) : (
                <ul className="divide-y">
                  {history.map((h) => (
                    <li key={h.id} className="space-y-1 px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {h.format}
                        </Badge>
                        <span className="text-sm font-medium">{TYPE_LABEL[h.type]}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {h.period} · {h.scopeLabel}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {format(parseISO(h.generatedAt), 'dd/MM/yyyy HH:mm', { locale: vi })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ───── Preview ─────
function ReportPreview({ data }: { data: ReportData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Badge variant="secondary">{data.type}</Badge>
          Preview · {data.period.from} → {data.period.to}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.type === 'CHANNEL' && (
          <div className="space-y-3">
            <PreviewTotals
              items={[
                ['Channels', data.totals.channels],
                ['Views', formatCompact(data.totals.views)],
                ['Watch Time', `${formatCompact(data.totals.watchTimeHours)}h`],
                ['Subs +', formatCompact(data.totals.subscribersGained)],
                ['Revenue', `$${data.totals.revenue.toFixed(2)}`],
              ]}
            />
            <PreviewTable
              headers={['Kênh', 'Views', 'Δ %', 'Eng']}
              rows={data.channels.slice(0, 5).map((c) => [
                c.name,
                formatCompact(c.views),
                c.viewsDeltaPct === null ? '—' : `${c.viewsDeltaPct.toFixed(1)}%`,
                `${c.avgEngagement.toFixed(1)}%`,
              ])}
              footer={
                data.channels.length > 5
                  ? `… và ${data.channels.length - 5} kênh khác (sẽ có đủ trong file export)`
                  : undefined
              }
            />
          </div>
        )}

        {data.type === 'HR' && (
          <div className="space-y-3">
            <PreviewTotals
              items={[['Members', data.totals.members]]}
            />
            <PreviewTable
              headers={['Tên', 'Email', 'Role', 'Groups']}
              rows={data.members.slice(0, 10).map((m) => [
                m.name,
                m.email,
                m.role,
                m.groups.join(', '),
              ])}
              footer={
                data.members.length > 10
                  ? `… và ${data.members.length - 10} thành viên khác`
                  : undefined
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PreviewTotals({ items }: { items: Array<[string, string | number]> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="text-base font-bold">{value}</div>
        </div>
      ))}
    </div>
  );
}

function PreviewTable({
  headers,
  rows,
  footer,
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
  footer?: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={cn('px-3 py-2 font-medium', i > 0 && 'text-right')}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    'px-3 py-2',
                    j > 0 && 'text-right tabular-nums',
                    j > 0 && j !== 1 && 'text-muted-foreground',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer && (
        <p className="border-t bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
          {footer}
        </p>
      )}
    </div>
  );
}

// suppress unused warning
void Skeleton;
