// EditEmployeeDialog — single-form edit + transfer-all-channels option.
'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeftRight, Check, Loader2, X } from 'lucide-react';

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
import { Separator } from '@/components/ui/separator';
import { useDepartments } from '@/hooks/use-departments';
import { usePermission } from '@/hooks/use-permission';
import {
  useTransferChannels,
  useUpdateUser,
  useUsers,
} from '@/hooks/use-users';
import type { HRUserDetail } from '@/lib/types/hr';

type Props = {
  user: HRUserDetail;
  open: boolean;
  onClose: () => void;
};

type Form = {
  name: string;
  phone: string;
  position: string;
  avatar: string;
  departmentId: string;
  joinDate: string; // YYYY-MM-DD
};

export function EditEmployeeDialog({ user, open, onClose }: Props) {
  const { atLeast, user: currentUser } = usePermission();
  const isSelf = currentUser?.id === user.id;
  const canManage = atLeast('GROUP_ADMIN');

  const [form, setForm] = useState<Form>({
    name: user.name,
    phone: user.phone ?? '',
    position: user.position ?? '',
    avatar: user.avatar ?? '',
    departmentId: user.department?.id ?? '',
    joinDate: user.joinDate ? user.joinDate.slice(0, 10) : '',
  });
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTo, setTransferTo] = useState<string>('');

  const { data: deptsResp } = useDepartments();
  const { data: usersResp } = useUsers();
  const update = useUpdateUser();
  const transfer = useTransferChannels();

  useEffect(() => {
    if (open) {
      setForm({
        name: user.name,
        phone: user.phone ?? '',
        position: user.position ?? '',
        avatar: user.avatar ?? '',
        departmentId: user.department?.id ?? '',
        joinDate: user.joinDate ? user.joinDate.slice(0, 10) : '',
      });
      setShowTransfer(false);
      setTransferTo('');
      update.reset();
      transfer.reset();
    }
  }, [open, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = deptsResp?.items ?? [];
  const users = usersResp?.items ?? [];
  const otherUsers = users.filter((u) => u.id !== user.id);

  const canSubmit =
    form.name.trim().length > 0 && !update.isPending && !transfer.isPending;
  const ownedCount = user.ownedChannels.length;

  const handleSave = () => {
    if (!canSubmit) return;
    update.mutate(
      {
        id: user.id,
        data: {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          position: form.position.trim() || null,
          avatar: form.avatar.trim() || null,
          departmentId: form.departmentId || null,
          joinDate: form.joinDate
            ? new Date(form.joinDate).toISOString()
            : null,
        },
      },
      {
        onSuccess: () => {
          if (!showTransfer || !transferTo) {
            onClose();
            return;
          }
          // Chain transfer-channels nếu user yêu cầu
          transfer.mutate(
            { id: user.id, toEmployeeId: transferTo },
            { onSuccess: () => onClose() },
          );
        },
      },
    );
  };

  const error =
    (update.error as Error | undefined)?.message ??
    (transfer.error as Error | undefined)?.message ??
    null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit nhân viên</DialogTitle>
          <DialogDescription>
            Cập nhật thông tin {user.name}. Email + password không edit được tại
            đây.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Avatar preview + url */}
          <div className="flex items-center gap-3 rounded-md border bg-muted/20 p-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={form.avatar || undefined} />
              <AvatarFallback>
                {form.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-xs">Avatar URL</Label>
              <Input
                value={form.avatar}
                onChange={(e) =>
                  setForm((f) => ({ ...f, avatar: e.target.value }))
                }
                placeholder="https://..."
                className="h-8"
              />
            </div>
          </div>

          {/* Personal */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ed-name">
                Họ tên <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ed-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ed-phone">Số điện thoại</Label>
              <Input
                id="ed-phone"
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ed-position">Position</Label>
              <Input
                id="ed-position"
                value={form.position}
                onChange={(e) =>
                  setForm((f) => ({ ...f, position: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ed-joinDate">Ngày join</Label>
              <Input
                id="ed-joinDate"
                type="date"
                value={form.joinDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, joinDate: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ed-dept">Phòng ban</Label>
              <select
                id="ed-dept"
                value={form.departmentId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, departmentId: e.target.value }))
                }
                disabled={!canManage}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <option value="">— Không thuộc phòng ban —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {!canManage && (
                <p className="text-[10px] text-muted-foreground">
                  Tenant Admin+ mới đổi được phòng ban.
                </p>
              )}
            </div>
          </div>

          {/* Transfer channels — chỉ cho TENANT_ADMIN+ và không phải self */}
          {canManage && !isSelf && ownedCount > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Transfer all channels</Label>
                    <p className="text-[10px] text-muted-foreground">
                      Chuyển tất cả {ownedCount} channel ownership của user này
                      sang user khác.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={showTransfer ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShowTransfer((v) => !v)}
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                    {showTransfer ? 'Đang transfer' : 'Bật transfer'}
                  </Button>
                </div>
                {showTransfer && (
                  <div className="rounded-md border bg-amber-500/5 p-3 space-y-2">
                    <Label htmlFor="ed-transfer-to">
                      Transfer to <span className="text-destructive">*</span>
                    </Label>
                    <select
                      id="ed-transfer-to"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">— Chọn destination —</option>
                      {otherUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-amber-700 dark:text-amber-400">
                      ⚠ Transfer sẽ chạy SAU KHI save profile thành công. Không
                      thể undo trực tiếp — phải transfer ngược lại bằng tay.
                    </p>
                    {transfer.isSuccess && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700"
                      >
                        <Check className="mr-1 h-3 w-3" />
                        Transferred {transfer.data?.transferred ?? 0}, merged{' '}
                        {transfer.data?.merged ?? 0}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={update.isPending || transfer.isPending}
          >
            <X className="h-4 w-4" />
            Huỷ
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !canSubmit ||
              (showTransfer && !transferTo)
            }
          >
            {update.isPending || transfer.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Lưu thay đổi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
