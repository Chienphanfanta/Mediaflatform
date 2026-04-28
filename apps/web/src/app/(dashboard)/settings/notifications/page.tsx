// /settings/notifications — toggle từng loại push + xem danh sách thiết bị.
'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Loader2,
  Smartphone,
  Trash2,
} from 'lucide-react';

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { usePushSubscription } from '@/hooks/use-push-subscription';

type Settings = {
  pushEnabled: boolean;
  alertCritical: boolean;
  alertHigh: boolean;
  alertMedium: boolean;
  postFailed: boolean;
  taskDeadline: boolean;
  workflowApproved: boolean;
  workflowRejected: boolean;
  workflowSubmitted: boolean;
  inAppEnabled: boolean;
  emailEnabled: boolean;
};

type Device = {
  id: string;
  endpointHost: string;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
};

const TOGGLES: Array<{
  key: keyof Settings;
  label: string;
  description: string;
}> = [
  {
    key: 'alertCritical',
    label: 'Cảnh báo CRITICAL',
    description: 'Strike, kênh suspended, quota cạn — ưu tiên cao nhất',
  },
  {
    key: 'alertHigh',
    label: 'Cảnh báo HIGH',
    description: 'Token sắp hết hạn, view drop nghiêm trọng, monetization risk',
  },
  {
    key: 'alertMedium',
    label: 'Cảnh báo MEDIUM',
    description: 'View drop nhẹ, kênh inactive 14 ngày (mặc định OFF — tránh spam)',
  },
  {
    key: 'postFailed',
    label: 'Bài đăng thất bại',
    description: 'Khi 3 lần retry exhausted',
  },
  {
    key: 'taskDeadline',
    label: 'Sắp đến hạn task',
    description: 'Task chưa done có dueDate trong 24h tới',
  },
  {
    key: 'workflowApproved',
    label: 'Bài được duyệt',
    description: 'Manager approve bài bạn submit',
  },
  {
    key: 'workflowRejected',
    label: 'Bài bị từ chối',
    description: 'Manager reject với feedback',
  },
  {
    key: 'workflowSubmitted',
    label: 'Có bài chờ duyệt',
    description: 'Staff submit bài cho bạn duyệt (chỉ Manager+)',
  },
];

export default function NotificationsSettingsPage() {
  const qc = useQueryClient();
  const push = usePushSubscription();

  const { data, isLoading, isError, error } = useQuery<{
    settings: Settings;
    devices: Device[];
  }>({
    queryKey: ['notification-settings'],
    queryFn: async () => {
      const r = await fetch('/api/v1/notifications/settings');
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message);
      return j.data;
    },
  });

  const update = useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const r = await fetch('/api/v1/notifications/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message);
      return j.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-settings'] }),
  });

  // Local snapshot để toggle responsive ngay (optimistic)
  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => {
    if (data?.settings) setDraft(data.settings);
  }, [data]);

  const toggle = (key: keyof Settings, value: boolean) => {
    if (!draft) return;
    const next = { ...draft, [key]: value };
    setDraft(next);
    update.mutate({ [key]: value });
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt thông báo</h1>
        <p className="text-sm text-muted-foreground">
          Chọn loại sự kiện nào sẽ gửi push notification + email cho bạn.
        </p>
      </div>

      {/* Master push toggle + browser permission state */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Push notifications trên trình duyệt
          </CardTitle>
          <CardDescription>
            Cần grant permission browser để nhận push real-time, kể cả khi app đóng.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PushPermissionBanner push={push} />

          {push.error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{push.error}</AlertDescription>
            </Alert>
          )}

          {draft && (
            <ToggleRow
              label="Bật push notifications"
              description="Master toggle — tắt = không gửi push gì cả (in-app + email vẫn theo cài đặt riêng)"
              checked={draft.pushEnabled}
              onChange={(v) => toggle('pushEnabled', v)}
            />
          )}
        </CardContent>
      </Card>

      {isError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Lỗi tải cài đặt</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải...</p>}

      {/* Per-event toggles */}
      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Loại sự kiện</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {TOGGLES.map((t, i) => (
              <div key={t.key}>
                {i > 0 && <Separator className="my-1" />}
                <ToggleRow
                  label={t.label}
                  description={t.description}
                  checked={draft[t.key]}
                  onChange={(v) => toggle(t.key, v)}
                  disabled={!draft.pushEnabled}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Channel preferences */}
      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kênh thông báo</CardTitle>
            <CardDescription>
              Áp dụng cho mọi loại sự kiện ở trên.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <ToggleRow
              label="In-app (chuông góc trên)"
              description="Polling mỗi 60 giây — luôn ON là tốt nhất"
              checked={draft.inAppEnabled}
              onChange={(v) => toggle('inAppEnabled', v)}
            />
            <Separator className="my-1" />
            <ToggleRow
              label="Email"
              description="Gửi qua Resend đến địa chỉ email tài khoản"
              checked={draft.emailEnabled}
              onChange={(v) => toggle('emailEnabled', v)}
            />
          </CardContent>
        </Card>
      )}

      {/* Devices list */}
      {data?.devices && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thiết bị đã đăng ký ({data.devices.length})</CardTitle>
            <CardDescription>
              Mỗi browser/thiết bị là 1 subscription riêng.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.devices.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Chưa có thiết bị nào đăng ký push. Bấm "Bật push" ở trên.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.devices.map((d) => (
                  <DeviceRow key={d.id} device={d} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Label
      className={`flex min-h-[56px] cursor-pointer items-start gap-3 rounded-md py-3 pr-2 ${
        disabled ? 'opacity-50' : 'hover:bg-muted/40'
      }`}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </Label>
  );
}

function PushPermissionBanner({
  push,
}: {
  push: ReturnType<typeof usePushSubscription>;
}) {
  if (push.state === 'unsupported') {
    return (
      <Alert>
        <BellOff className="h-4 w-4" />
        <AlertDescription>
          Trình duyệt không hỗ trợ Web Push. Dùng Chrome/Firefox/Edge desktop hoặc PWA cài trên iOS 16.4+ / Android.
        </AlertDescription>
      </Alert>
    );
  }
  if (push.state === 'denied') {
    return (
      <Alert variant="destructive">
        <BellOff className="h-4 w-4" />
        <AlertDescription>
          Bạn đã chặn notifications. Vào Settings trình duyệt → Site settings → Notifications để bật lại.
        </AlertDescription>
      </Alert>
    );
  }
  if (push.state === 'granted-subscribed') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
        <div className="flex items-center gap-2 text-sm">
          <Bell className="h-4 w-4 text-emerald-600" />
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            Đã bật push trên thiết bị này
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={push.disable}
          disabled={push.loading}
        >
          {push.loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Tắt push
        </Button>
      </div>
    );
  }
  // default | granted-not-subscribed
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
      <div className="text-sm">
        <p className="font-medium">Push chưa bật trên thiết bị này</p>
        <p className="text-xs text-muted-foreground">
          Bấm để xin permission và đăng ký device.
        </p>
      </div>
      <Button onClick={push.enable} disabled={push.loading}>
        {push.loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Bật push
      </Button>
    </div>
  );
}

function DeviceRow({ device }: { device: Device }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => {
      // Cần endpoint thật để DELETE — nhưng API trả endpointHost mask.
      // Workaround: chỉ user cùng device mới revoke được qua usePushSubscription.disable().
      // Cho UI: hiện disabled button + hint.
      throw new Error('Vào browser settings để revoke device này');
    },
  });
  return (
    <li className="flex items-start gap-3 rounded-md border p-3">
      <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{deviceName(device.userAgent)}</span>
          <Badge variant="secondary" className="text-[10px]">
            {device.endpointHost}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Đăng ký: {format(new Date(device.createdAt), 'dd/MM/yyyy', { locale: vi })}
          {' · '}
          Hoạt động {formatDistanceToNow(new Date(device.lastSeenAt), {
            addSuffix: true,
            locale: vi,
          })}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => remove.mutate()}
        disabled
        title="Vào browser settings để revoke"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

function deviceName(ua: string | null): string {
  if (!ua) return 'Thiết bị không xác định';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return ua.split(' ')[0];
}
