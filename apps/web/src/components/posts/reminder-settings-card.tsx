'use client';

// Thẻ cài đặt nhận nhắc lịch đăng bài qua Telegram / Zalo OA.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';

type MessagingState = {
  telegram: { enabled: boolean; botUsername: string | null; linked: boolean };
  zalo: { enabled: boolean; userId: string | null };
};

export function ReminderSettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me', 'messaging'],
    queryFn: () => apiFetch<MessagingState>('/api/v1/me/messaging'),
    // Đang chờ người dùng bấm /start trong Telegram → hỏi lại thường xuyên
    refetchInterval: (query) =>
      query.state.data && !query.state.data.telegram.linked ? 10_000 : false,
  });
  const [zaloId, setZaloId] = useState<string | null>(null);

  const linkM = useMutation({
    mutationFn: () => apiFetch<{ url: string }>('/api/v1/me/telegram-link', { method: 'POST' }),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
  });
  const unlinkM = useMutation({
    mutationFn: () => apiFetch<void>('/api/v1/me/telegram-link', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'messaging'] }),
  });
  const zaloM = useMutation({
    mutationFn: (value: string | null) =>
      apiFetch<MessagingState>('/api/v1/me/messaging', {
        method: 'PATCH',
        body: JSON.stringify({ zaloUserId: value }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['me', 'messaging'], data);
      setZaloId(null);
    },
  });

  const s = q.data;
  const error = linkM.error ?? unlinkM.error ?? zaloM.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4" />
          Nhận nhắc lịch đăng bài
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Đến giờ hẹn, hệ thống nhắn cho người phụ trách kênh (kèm cảnh báo nếu trình duyệt đang
          offline). Bài đăng lỗi sẽ được báo cho người soạn bài.
        </p>
        {q.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}

        {s && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Telegram</span>
              {s.telegram.linked && (
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Đã liên kết
                </span>
              )}
            </div>
            {!s.telegram.enabled ? (
              <p className="text-xs text-muted-foreground">
                Quản trị viên chưa cấu hình bot (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME).
              </p>
            ) : s.telegram.linked ? (
              <Button
                size="sm"
                variant="outline"
                disabled={unlinkM.isPending}
                onClick={() => unlinkM.mutate()}
              >
                Huỷ liên kết
              </Button>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Bấm nút bên dưới → Telegram mở bot @{s.telegram.botUsername} → bấm “Start”. Trang
                  này tự cập nhật khi liên kết xong.
                </p>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={linkM.isPending}
                  onClick={() => linkM.mutate()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Liên kết Telegram
                </Button>
              </>
            )}
          </div>
        )}

        {s && (
          <div className="space-y-2 rounded-md border p-3">
            <span className="font-medium">Zalo (Official Account)</span>
            {!s.zalo.enabled ? (
              <p className="text-xs text-muted-foreground">
                Quản trị viên chưa cấu hình Zalo OA (ZALO_APP_ID, ZALO_APP_SECRET,
                ZALO_OA_REFRESH_TOKEN).
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Quan tâm OA của công ty và nhắn 1 tin cho OA. Quản trị viên lấy user_id của bạn trong
                  trang quản lý OA rồi điền vào đây. Lưu ý: Zalo chỉ cho OA nhắn lại trong 7 ngày kể
                  từ lần cuối bạn tương tác với OA.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="zalo-id" className="text-xs">
                      Zalo user_id
                    </Label>
                    <Input
                      id="zalo-id"
                      className="h-8 w-56"
                      inputMode="numeric"
                      value={zaloId ?? s.zalo.userId ?? ''}
                      onChange={(e) => setZaloId(e.target.value)}
                      placeholder="vd 1234567890123456789"
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={zaloM.isPending || zaloId === null}
                    onClick={() => zaloM.mutate(zaloId?.trim() ? zaloId.trim() : null)}
                  >
                    Lưu
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
