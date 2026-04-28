// /kpi/assign — form giao KPI (MANAGER+).
// 3 modes: Single Employee KPI | Single Channel KPI | Bulk Assign.
// Submit → toast success → router.push('/kpi').
//
// Note: Day 8 Option B — KHÔNG có preview panel + achievement estimate
// (cần endpoint Analytics historical query — defer Sprint 9).
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Loader2,
  Target,
  Users,
} from 'lucide-react';
import type { KPIScope, PeriodType } from '@prisma/client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useChannelsList } from '@/hooks/use-channels-list';
import { useBulkAssignKpi, useCreateKpi } from '@/hooks/use-kpi';
import { usePermission } from '@/hooks/use-permission';
import { useUsers } from '@/hooks/use-users';
import { PLATFORM_LABEL } from '@/lib/platform';
import { cn } from '@/lib/utils';

type AssignMode = 'single-employee' | 'single-channel' | 'bulk';

type Form = {
  mode: AssignMode;
  // Subject
  channelId: string;
  employeeId: string;
  employeeIds: string[]; // bulk mode
  // Period
  periodType: PeriodType;
  periodStart: string; // YYYY-MM-DD
  // Targets
  targetFollowers: string;
  targetFollowersGain: string;
  targetViews: string;
  targetWatchTime: string;
  targetEngagement: string;
  notes: string;
};

function defaultForm(): Form {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    mode: 'single-employee',
    channelId: '',
    employeeId: '',
    employeeIds: [],
    periodType: 'MONTHLY',
    periodStart: start.toISOString().slice(0, 10),
    targetFollowers: '',
    targetFollowersGain: '',
    targetViews: '',
    targetWatchTime: '',
    targetEngagement: '',
    notes: '',
  };
}

export default function KpiAssignPage() {
  const router = useRouter();
  const { atLeast } = usePermission();
  const canManage = atLeast('MANAGER');

  const [form, setForm] = useState<Form>(defaultForm);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: channelsResp } = useChannelsList();
  const { data: usersResp } = useUsers();

  const create = useCreateKpi();
  const bulk = useBulkAssignKpi();

  // Reset selection on mode change
  useEffect(() => {
    setForm((f) => ({ ...f, channelId: '', employeeId: '', employeeIds: [] }));
  }, [form.mode]);

  if (!canManage) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <p className="text-sm font-medium">Chỉ Manager+ giao KPI</p>
        </CardContent>
      </Card>
    );
  }

  const channels = channelsResp ?? [];
  const users = usersResp?.items ?? [];

  const targetsValid =
    form.targetFollowers.trim() !== '' ||
    form.targetFollowersGain.trim() !== '' ||
    form.targetViews.trim() !== '' ||
    form.targetWatchTime.trim() !== '' ||
    form.targetEngagement.trim() !== '';

  const subjectValid =
    (form.mode === 'single-employee' && form.employeeId.trim() !== '') ||
    (form.mode === 'single-channel' &&
      form.channelId.trim() !== '' &&
      form.employeeId.trim() !== '') ||
    (form.mode === 'bulk' && form.employeeIds.length > 0);

  const canSubmit =
    subjectValid &&
    form.periodStart !== '' &&
    targetsValid &&
    !create.isPending &&
    !bulk.isPending;

  const isPending = create.isPending || bulk.isPending;

  const parseTarget = (s: string): number | null => {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
  };

  const sharedPayload = () => ({
    periodType: form.periodType,
    periodStart: new Date(form.periodStart).toISOString(),
    targetFollowers: parseTarget(form.targetFollowers),
    targetFollowersGain: parseTarget(form.targetFollowersGain),
    targetViews: parseTarget(form.targetViews),
    targetWatchTime: parseTarget(form.targetWatchTime),
    targetEngagement: parseTarget(form.targetEngagement),
    notes: form.notes.trim() || null,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitError(null);

    if (form.mode === 'single-employee') {
      // PER_EMPLOYEE — cross-channel KPI
      create.mutate(
        {
          scope: 'PER_EMPLOYEE',
          employeeId: form.employeeId,
          ...sharedPayload(),
        },
        {
          onSuccess: () => router.push('/kpi'),
          onError: (err) => setSubmitError(err.message),
        },
      );
      return;
    }

    if (form.mode === 'single-channel') {
      // PER_CHANNEL
      create.mutate(
        {
          scope: 'PER_CHANNEL',
          channelId: form.channelId,
          employeeId: form.employeeId,
          ...sharedPayload(),
        },
        {
          onSuccess: () => router.push('/kpi'),
          onError: (err) => setSubmitError(err.message),
        },
      );
      return;
    }

    // Bulk — PER_EMPLOYEE cho tất cả
    bulk.mutate(
      {
        scope: 'PER_EMPLOYEE',
        employeeIds: form.employeeIds,
        ...sharedPayload(),
      },
      {
        onSuccess: () => router.push('/kpi'),
        onError: (err) => setSubmitError(err.message),
      },
    );
  };

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/kpi">
          <ArrowLeft className="h-4 w-4" />
          Quay lại KPI Overview
        </Link>
      </Button>

      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Target className="h-7 w-7" />
          Giao KPI mới
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chọn mode + set ≥1 target. Cron 7h sáng tự recalc — có thể recalc
          manual sau.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Mode picker */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">1. Chọn mode</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            <ModeRadio
              active={form.mode === 'single-employee'}
              onClick={() => setForm((f) => ({ ...f, mode: 'single-employee' }))}
              title="Single Employee"
              desc="KPI cross-channel cho 1 nhân viên"
            />
            <ModeRadio
              active={form.mode === 'single-channel'}
              onClick={() => setForm((f) => ({ ...f, mode: 'single-channel' }))}
              title="Single Channel"
              desc="KPI gắn 1 kênh + 1 nhân viên"
            />
            <ModeRadio
              active={form.mode === 'bulk'}
              onClick={() => setForm((f) => ({ ...f, mode: 'bulk' }))}
              title="Bulk Assign"
              desc="Cùng KPI cho N nhân viên (cross-channel)"
            />
          </CardContent>
        </Card>

        {/* Subject */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">2. Đối tượng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {form.mode === 'single-channel' && (
              <div className="space-y-2">
                <Label htmlFor="ch-select">
                  Kênh <span className="text-destructive">*</span>
                </Label>
                <select
                  id="ch-select"
                  value={form.channelId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, channelId: e.target.value }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Chọn kênh —</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({PLATFORM_LABEL[c.platform]})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.mode !== 'bulk' ? (
              <div className="space-y-2">
                <Label htmlFor="emp-select">
                  Nhân viên <span className="text-destructive">*</span>
                </Label>
                <select
                  id="emp-select"
                  value={form.employeeId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, employeeId: e.target.value }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Chọn nhân viên —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <BulkEmployeeSelector
                users={users}
                selectedIds={form.employeeIds}
                onChange={(ids) =>
                  setForm((f) => ({ ...f, employeeIds: ids }))
                }
              />
            )}
          </CardContent>
        </Card>

        {/* Period */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">3. Period</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="period-type">Loại</Label>
              <select
                id="period-type"
                value={form.periodType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    periodType: e.target.value as PeriodType,
                  }))
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="MONTHLY">Tháng</option>
                <option value="QUARTERLY">Quý</option>
                <option value="YEARLY">Năm</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="period-start">Bắt đầu (auto-derive end)</Label>
              <Input
                id="period-start"
                type="date"
                value={form.periodStart}
                onChange={(e) =>
                  setForm((f) => ({ ...f, periodStart: e.target.value }))
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Targets */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              4. Targets{' '}
              <span className="text-xs font-normal text-muted-foreground">
                (set ≥1)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <TargetInput
              label="Followers tổng"
              value={form.targetFollowers}
              onChange={(v) =>
                setForm((f) => ({ ...f, targetFollowers: v }))
              }
              placeholder="220000"
              hint="End-of-period subscriber count"
            />
            <TargetInput
              label="Δ Followers"
              value={form.targetFollowersGain}
              onChange={(v) =>
                setForm((f) => ({ ...f, targetFollowersGain: v }))
              }
              placeholder="5000"
              hint="Tăng trưởng follower trong period"
            />
            <TargetInput
              label="Total views"
              value={form.targetViews}
              onChange={(v) => setForm((f) => ({ ...f, targetViews: v }))}
              placeholder="1500000"
            />
            <TargetInput
              label="Watch time (h)"
              value={form.targetWatchTime}
              onChange={(v) => setForm((f) => ({ ...f, targetWatchTime: v }))}
              placeholder="30000"
              hint="Chỉ YouTube"
            />
            <TargetInput
              label="Engagement rate (%)"
              value={form.targetEngagement}
              onChange={(v) =>
                setForm((f) => ({ ...f, targetEngagement: v }))
              }
              placeholder="5.0"
              hint="Chỉ FB / IG"
            />
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">5. Ghi chú (tuỳ chọn)</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              rows={3}
              placeholder="Mô tả ngữ cảnh, milestone, lý do giao KPI..."
            />
          </CardContent>
        </Card>

        {/* Validation hints */}
        {!targetsValid && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Phải set ít nhất 1 target.</AlertDescription>
          </Alert>
        )}
        {submitError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/kpi')}
            disabled={isPending}
          >
            Huỷ
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Target className="h-4 w-4" />
            )}
            {form.mode === 'bulk'
              ? `Giao KPI cho ${form.employeeIds.length} nhân viên`
              : 'Giao KPI'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ────────── Sub-components ──────────

function ModeRadio({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border p-3 text-left transition-colors',
        active
          ? 'border-primary bg-primary/5'
          : 'hover:border-primary/50 hover:bg-accent/30',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
            active ? 'border-primary bg-primary' : 'border-muted-foreground/40',
          )}
          aria-hidden="true"
        >
          {active && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
    </button>
  );
}

function BulkEmployeeSelector({
  users,
  selectedIds,
  onChange,
}: {
  users: Array<{ id: string; name: string; email: string; avatar: string | null }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          Nhân viên (chọn nhiều) <span className="text-destructive">*</span>
        </Label>
        <Badge variant="secondary" className="text-[10px]">
          <Users className="mr-1 h-3 w-3" />
          {selectedIds.length}/{users.length} đã chọn
        </Badge>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
        {users.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            Không có nhân viên trong tenant.
          </p>
        ) : (
          users.map((u) => {
            const checked = selectedIds.includes(u.id);
            return (
              <label
                key={u.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors',
                  checked ? 'bg-primary/5' : 'hover:bg-accent/40',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(u.id)}
                  className="h-4 w-4"
                />
                <Avatar className="h-6 w-6">
                  <AvatarImage src={u.avatar ?? undefined} />
                  <AvatarFallback className="text-[9px]">
                    {u.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{u.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {u.email}
                  </div>
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function TargetInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
