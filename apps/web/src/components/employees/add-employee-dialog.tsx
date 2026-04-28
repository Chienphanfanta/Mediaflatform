// AddEmployeeDialog — multi-step form (4 steps) tạo nhân viên mới.
// Day 9 Plan B: skip Avatar upload (URL placeholder), Welcome email (Sprint 10+).
'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Plus,
  X,
} from 'lucide-react';
import type { MemberRole } from '@prisma/client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { useChannelsList } from '@/hooks/use-channels-list';
import { useDepartments } from '@/hooks/use-departments';
import { usePermission } from '@/hooks/use-permission';
import { useCreateUser } from '@/hooks/use-users';
import { apiFetch } from '@/lib/api-client';
import { PLATFORM_LABEL } from '@/lib/platform';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
};

type Step = 1 | 2 | 3 | 4;

type ChannelAssignment = {
  channelId: string;
  role: 'PRIMARY' | 'SECONDARY';
};

type Form = {
  name: string;
  email: string;
  phone: string;
  position: string;
  avatar: string;
  departmentId: string;
  groupMemberships: Array<{ groupId: string; role: MemberRole }>;
  channelAssignments: ChannelAssignment[];
  password: string;
  confirmPassword: string;
};

const INITIAL_FORM: Form = {
  name: '',
  email: '',
  phone: '',
  position: '',
  avatar: '',
  departmentId: '',
  groupMemberships: [],
  channelAssignments: [],
  password: '',
  confirmPassword: '',
};

const STEP_LABELS: Record<Step, string> = {
  1: 'Thông tin cá nhân',
  2: 'Phòng ban + Role',
  3: 'Gán kênh (tuỳ chọn)',
  4: 'Mật khẩu',
};

const ROLE_OPTIONS: MemberRole[] = ['ADMIN', 'MANAGER', 'STAFF', 'VIEWER'];

export function AddEmployeeDialog({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<Form>(INITIAL_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [assignProgress, setAssignProgress] = useState<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);

  const { user: currentUser } = usePermission();
  const userGroups = currentUser?.groups ?? [];

  const { data: deptsResp } = useDepartments();
  const { data: channels } = useChannelsList();
  const create = useCreateUser();

  useEffect(() => {
    if (open) {
      setStep(1);
      setForm(INITIAL_FORM);
      setSubmitError(null);
      setAssignProgress(null);
      create.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = deptsResp?.items ?? [];
  const allChannels = channels ?? [];

  const step1Valid =
    form.name.trim().length > 0 && /\S+@\S+\.\S+/.test(form.email);
  const step4Valid =
    form.password.length >= 8 && form.password === form.confirmPassword;
  const canSubmit = step1Valid && step4Valid && !create.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitError(null);

    try {
      const created = await new Promise<{ id: string }>((resolve, reject) => {
        create.mutate(
          {
            email: form.email.toLowerCase().trim(),
            name: form.name.trim(),
            password: form.password,
            phone: form.phone.trim() || null,
            position: form.position.trim() || null,
            avatar: form.avatar.trim() || null,
            departmentId: form.departmentId || null,
            groupMemberships:
              form.groupMemberships.length > 0
                ? form.groupMemberships
                : undefined,
          },
          {
            onSuccess: (data) => resolve(data),
            onError: (err) => reject(err),
          },
        );
      });

      if (form.channelAssignments.length > 0) {
        setAssignProgress({
          done: 0,
          total: form.channelAssignments.length,
          failed: 0,
        });
        let done = 0;
        let failed = 0;
        for (const ca of form.channelAssignments) {
          try {
            await apiFetch(`/api/v1/channels/${ca.channelId}/owners`, {
              method: 'POST',
              body: JSON.stringify({
                employeeId: created.id,
                role: ca.role,
              }),
            });
            done++;
          } catch {
            failed++;
          }
          setAssignProgress({
            done,
            total: form.channelAssignments.length,
            failed,
          });
        }
      }

      onClose();
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Tạo nhân viên thất bại');
    }
  };

  const goNext = () => setStep((s) => (Math.min(4, s + 1) as Step));
  const goBack = () => setStep((s) => (Math.max(1, s - 1) as Step));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Thêm nhân viên mới</DialogTitle>
          <DialogDescription>
            Bước {step}/4 — {STEP_LABELS[step]}
          </DialogDescription>
        </DialogHeader>

        <StepIndicator current={step} />

        {step === 1 && <Step1Personal form={form} onChange={setForm} />}
        {step === 2 && (
          <Step2Org
            form={form}
            onChange={setForm}
            departments={departments}
            userGroups={userGroups}
          />
        )}
        {step === 3 && (
          <Step3Channels
            form={form}
            onChange={setForm}
            channels={allChannels}
          />
        )}
        {step === 4 && <Step4Password form={form} onChange={setForm} />}

        {(submitError || create.isError) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {submitError ?? (create.error as Error)?.message}
            </AlertDescription>
          </Alert>
        )}

        {assignProgress && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Gán channels: {assignProgress.done}/{assignProgress.total}
              {assignProgress.failed > 0 && ` (${assignProgress.failed} lỗi)`}
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter className="flex flex-row justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              if (step > 1) goBack();
              else onClose();
            }}
            disabled={create.isPending}
          >
            {step === 1 ? (
              <>
                <X className="h-4 w-4" />
                Huỷ
              </>
            ) : (
              <>
                <ArrowLeft className="h-4 w-4" />
                Quay lại
              </>
            )}
          </Button>

          {step < 4 ? (
            <Button onClick={goNext} disabled={step === 1 && !step1Valid}>
              Tiếp tục
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {create.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Tạo nhân viên
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────── Step indicator ──────────

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-2 py-2">
      {([1, 2, 3, 4] as const).map((s, i) => {
        const isCurrent = s === current;
        const isDone = s < current;
        return (
          <div key={s} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                isDone
                  ? 'bg-primary text-primary-foreground'
                  : isCurrent
                    ? 'border-2 border-primary text-primary'
                    : 'border bg-muted text-muted-foreground',
              )}
            >
              {isDone ? <Check className="h-3.5 w-3.5" /> : s}
            </div>
            <span
              className={cn(
                'hidden text-xs sm:inline',
                isCurrent ? 'font-medium' : 'text-muted-foreground',
              )}
            >
              {STEP_LABELS[s]}
            </span>
            {i < 3 && (
              <div
                className={cn(
                  'h-px flex-1',
                  isDone ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ────────── Step 1 ──────────

function Step1Personal({
  form,
  onChange,
}: {
  form: Form;
  onChange: (f: Form) => void;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-3 rounded-md border bg-muted/20 p-3">
        <Avatar className="h-12 w-12">
          <AvatarImage src={form.avatar || undefined} />
          <AvatarFallback>
            {form.name ? form.name.slice(0, 2).toUpperCase() : '?'}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <Label className="text-xs">Avatar URL (tuỳ chọn)</Label>
          <Input
            value={form.avatar}
            onChange={(e) => onChange({ ...form, avatar: e.target.value })}
            placeholder="https://..."
            className="h-8"
          />
          <p className="text-[10px] text-muted-foreground">
            Avatar upload trực tiếp — Sprint 10+ (cần file storage).
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="emp-name">
            Họ tên <span className="text-destructive">*</span>
          </Label>
          <Input
            id="emp-name"
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            placeholder="Nguyễn Văn A"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="emp-email">
            Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id="emp-email"
            type="email"
            value={form.email}
            onChange={(e) => onChange({ ...form, email: e.target.value })}
            placeholder="user@company.com"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="emp-phone">Số điện thoại</Label>
          <Input
            id="emp-phone"
            value={form.phone}
            onChange={(e) => onChange({ ...form, phone: e.target.value })}
            placeholder="+84 ..."
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="emp-position">Position</Label>
          <Input
            id="emp-position"
            value={form.position}
            onChange={(e) => onChange({ ...form, position: e.target.value })}
            placeholder="Senior Editor, Content Manager..."
          />
        </div>
      </div>
    </div>
  );
}

// ────────── Step 2 ──────────

function Step2Org({
  form,
  onChange,
  departments,
  userGroups,
}: {
  form: Form;
  onChange: (f: Form) => void;
  departments: Array<{ id: string; name: string; color: string | null }>;
  userGroups: Array<{ id: string; name: string }>;
}) {
  const updateGroupRole = (groupId: string, role: MemberRole | null) => {
    const without = form.groupMemberships.filter((m) => m.groupId !== groupId);
    onChange({
      ...form,
      groupMemberships: role ? [...without, { groupId, role }] : without,
    });
  };

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1">
        <Label htmlFor="emp-dept">Phòng ban</Label>
        <select
          id="emp-dept"
          aria-label="Phòng ban"
          value={form.departmentId}
          onChange={(e) => onChange({ ...form, departmentId: e.target.value })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">— Chưa thuộc phòng ban nào —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label>Group memberships (tuỳ chọn)</Label>
        <p className="text-[10px] text-muted-foreground">
          Group có vai trò RBAC scope. Chỉ assign vào group anh có quyền.
        </p>
        {userGroups.length === 0 ? (
          <p className="rounded-md border border-dashed py-3 text-center text-xs text-muted-foreground">
            Không có group nào để gán.
          </p>
        ) : (
          <div className="space-y-1.5">
            {userGroups.map((g) => {
              const current = form.groupMemberships.find(
                (m) => m.groupId === g.id,
              );
              return (
                <div
                  key={g.id}
                  className="flex items-center gap-2 rounded-md border p-2"
                >
                  <span className="flex-1 text-sm">{g.name}</span>
                  <select
                    value={current?.role ?? ''}
                    onChange={(e) =>
                      updateGroupRole(
                        g.id,
                        (e.target.value as MemberRole) || null,
                      )
                    }
                    className="flex h-8 rounded-md border border-input bg-background px-2 text-xs"
                    aria-label={`Role ở ${g.name}`}
                  >
                    <option value="">— Không gán —</option>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────── Step 3 ──────────

function Step3Channels({
  form,
  onChange,
  channels,
}: {
  form: Form;
  onChange: (f: Form) => void;
  channels: Array<{ id: string; name: string; platform: string }>;
}) {
  const toggleChannel = (
    channelId: string,
    role: 'PRIMARY' | 'SECONDARY' | null,
  ) => {
    const without = form.channelAssignments.filter(
      (a) => a.channelId !== channelId,
    );
    onChange({
      ...form,
      channelAssignments: role ? [...without, { channelId, role }] : without,
    });
  };

  return (
    <div className="space-y-3 py-2">
      <p className="text-xs text-muted-foreground">
        Gán channels (tuỳ chọn) — có thể skip và làm sau ở /channels/[id].
      </p>

      {channels.length === 0 ? (
        <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
          Chưa có kênh nào trong tenant.
        </p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
          {channels.map((c) => {
            const assignment = form.channelAssignments.find(
              (a) => a.channelId === c.id,
            );
            return (
              <div
                key={c.id}
                className={cn(
                  'flex items-center gap-2 rounded p-2 transition-colors',
                  assignment ? 'bg-primary/5' : 'hover:bg-accent/40',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {PLATFORM_LABEL[
                      c.platform as keyof typeof PLATFORM_LABEL
                    ] ?? c.platform}
                  </div>
                </div>
                <select
                  value={assignment?.role ?? ''}
                  onChange={(e) =>
                    toggleChannel(
                      c.id,
                      (e.target.value as 'PRIMARY' | 'SECONDARY') || null,
                    )
                  }
                  className="flex h-8 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label={`Role ở ${c.name}`}
                >
                  <option value="">— Không gán —</option>
                  <option value="PRIMARY">PRIMARY</option>
                  <option value="SECONDARY">SECONDARY</option>
                </select>
              </div>
            );
          })}
        </div>
      )}

      {form.channelAssignments.length > 0 && (
        <Card className="bg-primary/5 p-3">
          <p className="text-xs">
            <Badge variant="secondary" className="mr-1 text-[10px]">
              {form.channelAssignments.length}
            </Badge>
            channels sẽ được gán sau khi tạo user.
          </p>
        </Card>
      )}
    </div>
  );
}

// ────────── Step 4 ──────────

function Step4Password({
  form,
  onChange,
}: {
  form: Form;
  onChange: (f: Form) => void;
}) {
  const matches = form.password === form.confirmPassword;

  return (
    <div className="space-y-3 py-2">
      <div className="space-y-1">
        <Label htmlFor="emp-pwd">
          Mật khẩu ban đầu <span className="text-destructive">*</span>
        </Label>
        <Input
          id="emp-pwd"
          type="password"
          value={form.password}
          onChange={(e) => onChange({ ...form, password: e.target.value })}
          placeholder="Tối thiểu 8 ký tự"
        />
        <p className="text-[10px] text-muted-foreground">
          Min 8 ký tự. Welcome email tự động — Sprint 10+.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="emp-pwd-confirm">
          Nhập lại mật khẩu <span className="text-destructive">*</span>
        </Label>
        <Input
          id="emp-pwd-confirm"
          type="password"
          value={form.confirmPassword}
          onChange={(e) =>
            onChange({ ...form, confirmPassword: e.target.value })
          }
          aria-invalid={form.confirmPassword !== '' && !matches}
        />
        {form.confirmPassword !== '' && !matches && (
          <p className="text-[10px] text-destructive">Mật khẩu không khớp.</p>
        )}
      </div>
    </div>
  );
}
