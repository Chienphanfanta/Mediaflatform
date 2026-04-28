'use client';

// CreateKpiDialog — form giao KPI mới (MANAGER+).
// Workflow:
//   1. Chọn scope (PER_CHANNEL | PER_EMPLOYEE)
//   2. Chọn employee (required)
//   3. Chọn channel (required nếu PER_CHANNEL)
//   4. Chọn periodType + periodStart (auto derive periodEnd)
//   5. Set ≥1 target (followers/gain/views/watchTime/engagement)
//   6. Submit → POST /api/v1/kpi
//
// Optional pre-fill: dùng `defaultChannelId` hoặc `defaultEmployeeId` khi mở
// dialog từ context cha (channel detail / employee detail).
import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Target } from 'lucide-react';
import type { KPIScope, PeriodType } from '@prisma/client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useChannelsList } from '@/hooks/use-channels-list';
import { useCreateKpi } from '@/hooks/use-kpi';
import { useUsers } from '@/hooks/use-users';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Khoá scope=PER_CHANNEL với channel này (vd mở từ channel detail) */
  defaultChannelId?: string;
  /** Pre-fill employee (vd mở từ employee detail) */
  defaultEmployeeId?: string;
};

type Form = {
  scope: KPIScope;
  channelId: string;
  employeeId: string;
  periodType: PeriodType;
  periodStart: string; // YYYY-MM-DD
  targetFollowers: string;
  targetFollowersGain: string;
  targetViews: string;
  targetWatchTime: string;
  targetEngagement: string;
  notes: string;
};

function defaultForm(opts?: { channelId?: string; employeeId?: string }): Form {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    scope: opts?.channelId ? 'PER_CHANNEL' : 'PER_EMPLOYEE',
    channelId: opts?.channelId ?? '',
    employeeId: opts?.employeeId ?? '',
    periodType: 'MONTHLY',
    periodStart: periodStart.toISOString().slice(0, 10),
    targetFollowers: '',
    targetFollowersGain: '',
    targetViews: '',
    targetWatchTime: '',
    targetEngagement: '',
    notes: '',
  };
}

export function CreateKpiDialog({
  open,
  onClose,
  defaultChannelId,
  defaultEmployeeId,
}: Props) {
  const [form, setForm] = useState<Form>(() =>
    defaultForm({ channelId: defaultChannelId, employeeId: defaultEmployeeId }),
  );

  const { data: channelsResp } = useChannelsList();
  const { data: usersResp } = useUsers();
  const create = useCreateKpi();

  const channels = channelsResp ?? [];
  const users = usersResp?.items ?? [];

  // Reset form when opening
  useEffect(() => {
    if (open) {
      setForm(
        defaultForm({
          channelId: defaultChannelId,
          employeeId: defaultEmployeeId,
        }),
      );
      create.reset();
    }
  }, [open, defaultChannelId, defaultEmployeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetsValid =
    form.targetFollowers.trim() !== '' ||
    form.targetFollowersGain.trim() !== '' ||
    form.targetViews.trim() !== '' ||
    form.targetWatchTime.trim() !== '' ||
    form.targetEngagement.trim() !== '';

  const canSubmit =
    form.employeeId.trim() !== '' &&
    (form.scope === 'PER_EMPLOYEE' || form.channelId.trim() !== '') &&
    form.periodStart.trim() !== '' &&
    targetsValid &&
    !create.isPending;

  const parseTarget = (s: string): number | null => {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    create.mutate(
      {
        scope: form.scope,
        channelId:
          form.scope === 'PER_CHANNEL' ? form.channelId : undefined,
        employeeId: form.employeeId,
        periodType: form.periodType,
        periodStart: new Date(form.periodStart).toISOString(),
        targetFollowers: parseTarget(form.targetFollowers),
        targetFollowersGain: parseTarget(form.targetFollowersGain),
        targetViews: parseTarget(form.targetViews),
        targetWatchTime: parseTarget(form.targetWatchTime),
        targetEngagement: parseTarget(form.targetEngagement),
        notes: form.notes.trim() || null,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Giao KPI mới
          </DialogTitle>
          <DialogDescription>
            Set ≥1 target. Cron 7h sáng tự recalc; có thể trigger manual sau.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Scope */}
          <div className="space-y-2">
            <Label>
              Phạm vi <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2">
              <ScopePill
                active={form.scope === 'PER_CHANNEL'}
                disabled={!!defaultChannelId && form.scope === 'PER_CHANNEL'}
                onClick={() =>
                  setForm((f) => ({ ...f, scope: 'PER_CHANNEL' }))
                }
              >
                Theo kênh
              </ScopePill>
              <ScopePill
                active={form.scope === 'PER_EMPLOYEE'}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    scope: 'PER_EMPLOYEE',
                    channelId: '',
                  }))
                }
              >
                Theo nhân viên (cross-channel)
              </ScopePill>
            </div>
          </div>

          {/* Channel — chỉ khi PER_CHANNEL */}
          {form.scope === 'PER_CHANNEL' && (
            <div className="space-y-2">
              <Label htmlFor="kpi-channel">
                Kênh <span className="text-destructive">*</span>
              </Label>
              <select
                id="kpi-channel"
                value={form.channelId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, channelId: e.target.value }))
                }
                disabled={!!defaultChannelId}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <option value="">— Chọn kênh —</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.platform})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Employee */}
          <div className="space-y-2">
            <Label htmlFor="kpi-employee">
              Nhân viên <span className="text-destructive">*</span>
            </Label>
            <select
              id="kpi-employee"
              value={form.employeeId}
              onChange={(e) =>
                setForm((f) => ({ ...f, employeeId: e.target.value }))
              }
              disabled={!!defaultEmployeeId}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <option value="">— Chọn nhân viên —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>

          {/* Period type + start */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="kpi-period-type">Period</Label>
              <select
                id="kpi-period-type"
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
              <Label htmlFor="kpi-period-start">Bắt đầu</Label>
              <Input
                id="kpi-period-start"
                type="date"
                value={form.periodStart}
                onChange={(e) =>
                  setForm((f) => ({ ...f, periodStart: e.target.value }))
                }
              />
            </div>
          </div>

          {/* Targets — ≥1 required */}
          <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <Label>
              Targets <span className="text-destructive">*</span>{' '}
              <span className="text-xs font-normal text-muted-foreground">
                (set ≥1)
              </span>
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <TargetInput
                label="Followers"
                value={form.targetFollowers}
                onChange={(v) =>
                  setForm((f) => ({ ...f, targetFollowers: v }))
                }
                placeholder="220000"
              />
              <TargetInput
                label="Δ Followers"
                value={form.targetFollowersGain}
                onChange={(v) =>
                  setForm((f) => ({ ...f, targetFollowersGain: v }))
                }
                placeholder="5000"
              />
              <TargetInput
                label="Views"
                value={form.targetViews}
                onChange={(v) => setForm((f) => ({ ...f, targetViews: v }))}
                placeholder="1500000"
              />
              <TargetInput
                label="Watch time (h)"
                value={form.targetWatchTime}
                onChange={(v) =>
                  setForm((f) => ({ ...f, targetWatchTime: v }))
                }
                placeholder="30000"
              />
              <TargetInput
                label="Engagement (%)"
                value={form.targetEngagement}
                onChange={(v) =>
                  setForm((f) => ({ ...f, targetEngagement: v }))
                }
                placeholder="5.0"
              />
            </div>
            {!targetsValid && (
              <p className="text-[10px] text-amber-600">
                ⚠ Phải set ít nhất 1 target để KPI hợp lệ
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="kpi-notes">Ghi chú (tuỳ chọn)</Label>
            <Textarea
              id="kpi-notes"
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              rows={2}
              placeholder="Mô tả ngữ cảnh KPI, milestone..."
            />
          </div>

          {create.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {(create.error as Error).message}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={create.isPending}
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {create.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Target className="h-4 w-4" />
              )}
              Giao KPI
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScopePill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex-1 rounded-md border px-3 py-2 text-sm transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'hover:bg-accent',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {children}
    </button>
  );
}

function TargetInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
    </div>
  );
}
