'use client';

import { useRouter } from 'next/navigation';
import type { Platform } from '@prisma/client';
import { ArrowRight } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PLATFORMS, PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';

type Props = {
  open: boolean;
  onClose: () => void;
};

const PLATFORM_NOTE: Record<Platform, string> = {
  YOUTUBE: 'OAuth 2.0 — cần Google account quản lý channel',
  FACEBOOK: 'OAuth 2.0 — cần admin Facebook Page',
  INSTAGRAM: 'OAuth 2.0 — IG Business Account đã link Facebook Page',
  X: 'OAuth 2.0 + PKCE — cần X account',
  TELEGRAM: 'Bot token từ @BotFather — không cần OAuth',
  WHATSAPP: 'WhatsApp Business — chưa hỗ trợ Phase 0',
};

export function ConnectChannelDialog({ open, onClose }: Props) {
  const router = useRouter();

  const handleSelect = (platform: Platform) => {
    if (platform === 'WHATSAPP') return;
    onClose();
    // /channels/connect handle full flow (group select + OAuth redirect / Telegram form)
    router.push(`/channels/connect?platform=${platform.toLowerCase()}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Kết nối kênh truyền thông mới</DialogTitle>
          <DialogDescription>
            Chọn nền tảng — bạn sẽ chuyển sang trang authorize hoặc form bot token.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {PLATFORMS.map((p) => {
            const disabled = p === 'WHATSAPP';
            return (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => handleSelect(p)}
                className={cn(
                  'group flex items-center gap-3 rounded-lg border p-4 text-left transition-colors',
                  !disabled && 'hover:border-primary/60 hover:bg-accent/30',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
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
                    {disabled && (
                      <Badge variant="outline" className="text-[10px]">
                        Phase 6+
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {PLATFORM_NOTE[p]}
                  </p>
                </div>
                {!disabled && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                )}
              </button>
            );
          })}
        </div>

        <p className="border-t pt-3 text-[11px] text-muted-foreground">
          🔒 Token được mã hoá AES-256-GCM trước khi lưu DB. Mọi flow OAuth có signed
          state cookie + PKCE (X) chống CSRF.
        </p>
      </DialogContent>
    </Dialog>
  );
}
