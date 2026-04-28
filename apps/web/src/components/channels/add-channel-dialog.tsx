'use client';

// Multi-step dialog "Thêm kênh mới" — V2 Plan A1+A2+A3.
// Step 1: pick platform
// Step 2: channel info (name, externalUrl, accountId, category, description)
// Step 3: assign owners (PRIMARY required + SECONDARY optional)
// Step 4: review + connect (manual save POST /api/v1/channels OR redirect OAuth)
//
// OAuth integration: nếu user chọn "Kết nối qua OAuth", dialog redirect sang
// /channels/connect?platform=X (legacy flow). Manual create vẫn lưu record nhưng
// không có access token — user phải connect sau.
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { Platform } from '@prisma/client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
import { useCreateChannel } from '@/hooks/use-channels-list';
import { usePermission } from '@/hooks/use-permission';
import { useUsers } from '@/hooks/use-users';
import { cn } from '@/lib/utils';
import { PLATFORMS, PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';

const PLATFORM_NOTE: Record<Platform, string> = {
  YOUTUBE: 'OAuth 2.0 — cần Google account quản lý channel',
  FACEBOOK: 'OAuth 2.0 — cần admin Facebook Page',
  INSTAGRAM: 'OAuth 2.0 — IG Business Account đã link Facebook Page',
  X: 'OAuth 2.0 + PKCE — cần X account',
  TELEGRAM: 'Bot token từ @BotFather — không cần OAuth',
  WHATSAPP: 'WhatsApp Business — Phone number ID + access token',
};

const OAUTH_PLATFORMS: Platform[] = ['YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'X'];

type Step = 1 | 2 | 3 | 4;

type Props = {
  open: boolean;
  onClose: () => void;
};

type FormState = {
  platform: Platform | null;
  name: string;
  accountId: string;
  externalUrl: string;
  category: string;
  description: string;
  groupIds: string[];
  primaryOwnerId: string;
  secondaryOwnerIds: string[];
};

const INITIAL_FORM: FormState = {
  platform: null,
  name: '',
  accountId: '',
  externalUrl: '',
  category: '',
  description: '',
  groupIds: [],
  primaryOwnerId: '',
  secondaryOwnerIds: [],
};

export function AddChannelDialog({ open, onClose }: Props) {
  const router = useRouter();
  const { user } = usePermission();
  const userGroups = user?.groups ?? [];

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const create = useCreateChannel();
  const { data: usersResp, isLoading: usersLoading } = useUsers();
  const users = usersResp?.items ?? [];

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1);
      setForm(INITIAL_FORM);
      create.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOAuthPlatform =
    form.platform !== null && OAUTH_PLATFORMS.includes(form.platform);

  const canNextFromStep2 =
    form.name.trim().length > 0 && form.accountId.trim().length > 0;
  const canNextFromStep3 = form.primaryOwnerId.length > 0;

  const primary = users.find((u) => u.id === form.primaryOwnerId);
  const secondaryUsers = useMemo(
    () => users.filter((u) => form.secondaryOwnerIds.includes(u.id)),
    [users, form.secondaryOwnerIds],
  );

  const availableSecondary = useMemo(
    () =>
      users.filter(
        (u) =>
          u.id !== form.primaryOwnerId &&
          !form.secondaryOwnerIds.includes(u.id),
      ),
    [users, form.primaryOwnerId, form.secondaryOwnerIds],
  );

  const handlePickPlatform = (p: Platform) => {
    setForm((f) => ({ ...f, platform: p }));
    setStep(2);
  };

  const handleManualSave = () => {
    if (!form.platform || !canNextFromStep2 || !canNextFromStep3) return;
    create.mutate(
      {
        platform: form.platform,
        name: form.name.trim(),
        accountId: form.accountId.trim(),
        externalUrl: form.externalUrl.trim() || null,
        category: form.category.trim() || null,
        description: form.description.trim() || null,
        groupIds: form.groupIds,
        primaryOwnerId: form.primaryOwnerId,
      },
      {
        onSuccess: () => {
          onClose();
          // Note: SECONDARY owners được assign sau qua /channels/[id]/owners endpoint
          // (tránh phải làm batch-assign trong 1 step). Step 4.5 sẽ wire đầy đủ.
        },
      },
    );
  };

  const handleConnectOAuth = () => {
    if (!form.platform) return;
    onClose();
    router.push(`/channels/connect?platform=${form.platform.toLowerCase()}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Thêm kênh truyền thông mới</DialogTitle>
          <DialogDescription>
            Bước {step}/4 — {STEP_LABELS[step]}
          </DialogDescription>
        </DialogHeader>

        <StepIndicator current={step} />

        {step === 1 && (
          <Step1PickPlatform onPick={handlePickPlatform} />
        )}

        {step === 2 && form.platform && (
          <Step2ChannelInfo
            platform={form.platform}
            form={form}
            onChange={setForm}
          />
        )}

        {step === 3 && (
          <Step3Owners
            users={users}
            usersLoading={usersLoading}
            primary={primary}
            secondaryUsers={secondaryUsers}
            availableSecondary={availableSecondary}
            primaryOwnerId={form.primaryOwnerId}
            onPrimaryChange={(id) =>
              setForm((f) => ({ ...f, primaryOwnerId: id }))
            }
            onAddSecondary={(id) =>
              setForm((f) => ({
                ...f,
                secondaryOwnerIds: [...f.secondaryOwnerIds, id],
              }))
            }
            onRemoveSecondary={(id) =>
              setForm((f) => ({
                ...f,
                secondaryOwnerIds: f.secondaryOwnerIds.filter((x) => x !== id),
              }))
            }
            groupIds={form.groupIds}
            onToggleGroup={(gid) =>
              setForm((f) => ({
                ...f,
                groupIds: f.groupIds.includes(gid)
                  ? f.groupIds.filter((x) => x !== gid)
                  : [...f.groupIds, gid],
              }))
            }
            userGroups={userGroups}
          />
        )}

        {step === 4 && form.platform && (
          <Step4Review
            form={form}
            primary={primary}
            secondaryUsers={secondaryUsers}
            isOAuthPlatform={isOAuthPlatform}
            onConnectOAuth={handleConnectOAuth}
            onManualSave={handleManualSave}
            isPending={create.isPending}
            error={create.error?.message ?? null}
          />
        )}

        <DialogFooter className="flex flex-row justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              if (step > 1) setStep((s) => (s - 1) as Step);
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

          {step < 4 && (
            <Button
              onClick={() => setStep((s) => (Math.min(s + 1, 4) as Step))}
              disabled={
                step === 1 ||
                (step === 2 && !canNextFromStep2) ||
                (step === 3 && !canNextFromStep3)
              }
            >
              Tiếp tục
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────── Step indicator ──────────

const STEP_LABELS: Record<Step, string> = {
  1: 'Chọn nền tảng',
  2: 'Thông tin kênh',
  3: 'Gán owners',
  4: 'Kết nối API',
};

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

// ────────── Step 1: pick platform ──────────

function Step1PickPlatform({
  onPick,
}: {
  onPick: (p: Platform) => void;
}) {
  return (
    <div className="grid gap-3 py-2 sm:grid-cols-2">
      {PLATFORMS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className="group flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent/30"
        >
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white',
              PLATFORM_DOT[p],
            )}
          >
            {PLATFORM_LABEL[p][0]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{PLATFORM_LABEL[p]}</span>
              {p === 'TELEGRAM' && (
                <Badge variant="outline" className="text-[10px]">
                  Bot
                </Badge>
              )}
              {p === 'WHATSAPP' && (
                <Badge variant="outline" className="text-[10px]">
                  Manual
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {PLATFORM_NOTE[p]}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </button>
      ))}
    </div>
  );
}

// ────────── Step 2: channel info form ──────────

function Step2ChannelInfo({
  platform,
  form,
  onChange,
}: {
  platform: Platform;
  form: FormState;
  onChange: (next: FormState) => void;
}) {
  const accountIdLabel: Record<Platform, string> = {
    YOUTUBE: 'Channel ID (UCxxx...)',
    FACEBOOK: 'Page ID',
    INSTAGRAM: 'IG User ID (số)',
    X: 'X User ID',
    TELEGRAM: 'Chat ID (-100...)',
    WHATSAPP: 'Phone Number ID',
  };

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-white',
            PLATFORM_DOT[platform],
          )}
        >
          {PLATFORM_LABEL[platform][0]}
        </span>
        <span className="font-medium">{PLATFORM_LABEL[platform]}</span>
        <span className="text-muted-foreground">· {PLATFORM_NOTE[platform]}</span>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ch-name">
          Tên hiển thị <span className="text-destructive">*</span>
        </Label>
        <Input
          id="ch-name"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="Vd: Company Official YouTube"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ch-account">
            {accountIdLabel[platform]} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ch-account"
            value={form.accountId}
            onChange={(e) => onChange({ ...form, accountId: e.target.value })}
            placeholder={accountIdLabel[platform]}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ch-url">URL công khai</Label>
          <Input
            id="ch-url"
            type="url"
            value={form.externalUrl}
            onChange={(e) => onChange({ ...form, externalUrl: e.target.value })}
            placeholder="https://..."
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ch-category">Category (tuỳ chọn)</Label>
        <Input
          id="ch-category"
          value={form.category}
          onChange={(e) => onChange({ ...form, category: e.target.value })}
          placeholder="Vd: Tin tức, Giải trí, Lifestyle..."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ch-desc">Mô tả (tuỳ chọn)</Label>
        <Textarea
          id="ch-desc"
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          placeholder="Mô tả ngắn về kênh, đối tượng, mục tiêu..."
          rows={3}
        />
      </div>
    </div>
  );
}

// ────────── Step 3: assign owners ──────────

type SimpleUser = { id: string; name: string; email: string; avatar: string | null };

function Step3Owners({
  users,
  usersLoading,
  primary,
  secondaryUsers,
  availableSecondary,
  primaryOwnerId,
  onPrimaryChange,
  onAddSecondary,
  onRemoveSecondary,
  groupIds,
  onToggleGroup,
  userGroups,
}: {
  users: SimpleUser[];
  usersLoading: boolean;
  primary: SimpleUser | undefined;
  secondaryUsers: SimpleUser[];
  availableSecondary: SimpleUser[];
  primaryOwnerId: string;
  onPrimaryChange: (id: string) => void;
  onAddSecondary: (id: string) => void;
  onRemoveSecondary: (id: string) => void;
  groupIds: string[];
  onToggleGroup: (gid: string) => void;
  userGroups: Array<{ id: string; name: string }>;
}) {
  if (usersLoading) {
    return (
      <div className="space-y-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang tải danh sách nhân sự...
      </div>
    );
  }

  const eligiblePrimary = users.filter((u) => u.id !== '');

  return (
    <div className="space-y-4 py-2">
      {/* PRIMARY */}
      <div className="space-y-2">
        <Label htmlFor="primary-owner">
          PRIMARY owner <span className="text-destructive">*</span>
        </Label>
        <select
          id="primary-owner"
          value={primaryOwnerId}
          onChange={(e) => onPrimaryChange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">— Chọn nhân sự —</option>
          {eligiblePrimary.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
        {primary && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
            <Avatar className="h-7 w-7">
              <AvatarImage src={primary.avatar ?? undefined} />
              <AvatarFallback className="text-[10px]">
                {primary.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{primary.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {primary.email}
              </div>
            </div>
            <Badge variant="outline" className="text-[10px]">
              PRIMARY
            </Badge>
          </div>
        )}
      </div>

      {/* SECONDARY */}
      <div className="space-y-2">
        <Label>SECONDARY owners (tuỳ chọn)</Label>
        <div className="space-y-1.5">
          {secondaryUsers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Chưa có ai. Có thể thêm sau.
            </p>
          ) : (
            secondaryUsers.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5"
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage src={u.avatar ?? undefined} />
                  <AvatarFallback className="text-[9px]">
                    {u.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{u.name}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onRemoveSecondary(u.id)}
                  aria-label={`Bỏ ${u.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
        {availableSecondary.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onAddSecondary(e.target.value);
            }}
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Thêm SECONDARY owner"
          >
            <option value="">+ Thêm SECONDARY owner</option>
            {availableSecondary.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Groups */}
      {userGroups.length > 0 && (
        <div className="space-y-2">
          <Label>Gán vào groups (tuỳ chọn)</Label>
          <div className="flex flex-wrap gap-1.5">
            {userGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onToggleGroup(g.id)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs transition-colors',
                  groupIds.includes(g.id)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-accent',
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────── Step 4: review + connect ──────────

function Step4Review({
  form,
  primary,
  secondaryUsers,
  isOAuthPlatform,
  onConnectOAuth,
  onManualSave,
  isPending,
  error,
}: {
  form: FormState;
  primary: SimpleUser | undefined;
  secondaryUsers: SimpleUser[];
  isOAuthPlatform: boolean;
  onConnectOAuth: () => void;
  onManualSave: () => void;
  isPending: boolean;
  error: string | null;
}) {
  if (!form.platform) return null;

  return (
    <div className="space-y-3 py-2">
      <div className="rounded-lg border bg-muted/20 p-3 text-sm">
        <div className="mb-2 flex items-center gap-2">
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded text-xs font-bold text-white',
              PLATFORM_DOT[form.platform],
            )}
          >
            {PLATFORM_LABEL[form.platform][0]}
          </span>
          <span className="font-semibold">{form.name}</span>
          <Badge variant="outline" className="text-[10px]">
            {PLATFORM_LABEL[form.platform]}
          </Badge>
        </div>
        <dl className="grid gap-1 text-xs">
          <Row label="Account ID" value={form.accountId} />
          {form.externalUrl && <Row label="URL" value={form.externalUrl} />}
          {form.category && <Row label="Category" value={form.category} />}
          {form.description && (
            <Row label="Description" value={form.description} />
          )}
          <Row
            label="PRIMARY"
            value={primary ? `${primary.name} (${primary.email})` : '—'}
          />
          <Row
            label="SECONDARY"
            value={
              secondaryUsers.length > 0
                ? secondaryUsers.map((u) => u.name).join(', ')
                : '—'
            }
          />
        </dl>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2 rounded-lg border border-dashed p-3">
        <p className="text-xs font-medium">Bước cuối: kết nối</p>
        {isOAuthPlatform ? (
          <>
            <p className="text-xs text-muted-foreground">
              Platform này dùng OAuth. Anh có thể:
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="default"
                onClick={onConnectOAuth}
                disabled={isPending}
              >
                <ExternalLink className="h-4 w-4" />
                Kết nối qua OAuth
              </Button>
              <Button
                variant="outline"
                onClick={onManualSave}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Lưu manual (không sync)
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              OAuth: redirect sang provider — sau khi authorize sẽ tự sync analytics.
              Manual: chỉ tạo record, sync sẽ disabled cho đến khi connect API.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {form.platform === 'TELEGRAM'
                ? 'Telegram: bot token đã có sẵn → manual create. Để bot fetch metrics, gán bot làm admin trong channel.'
                : 'Manual create — sync API sẽ wire sau từ trang chi tiết.'}
            </p>
            <Button onClick={onManualSave} disabled={isPending} className="w-full">
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Lưu kênh
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 flex-1 truncate">{value}</dd>
    </div>
  );
}
