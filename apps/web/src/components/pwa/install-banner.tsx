// PWAInstallBanner — bắt event `beforeinstallprompt` (Chromium) hiển thị thanh
// cài app trượt từ dưới lên. Chỉ render khi browser support A2HS + chưa từng dismiss.
//
// iOS Safari KHÔNG fire beforeinstallprompt — Apple yêu cầu user manual "Add to
// Home Screen". Detect iOS riêng → show hint Vietnamese "Bấm Chia sẻ → Thêm vào
// màn hình chính".
'use client';

import { useEffect, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

const DISMISS_KEY = 'pwa-install-dismissed-at';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const SUPPRESS_PATHS = ['/login', '/forbidden', '/offline'];

// Type chuẩn cho event Chromium A2HS — TypeScript không có sẵn.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
}

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Suppress trên auth/error pages
    if (SUPPRESS_PATHS.some((p) => window.location.pathname.startsWith(p))) {
      return;
    }

    // Đã dismiss < 7 ngày → skip
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return;

    // Đã cài (display-mode standalone) → skip
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari standalone flag
      (navigator as unknown as { standalone?: boolean }).standalone
    ) {
      return;
    }

    // iOS detect — fire hint thay cho native prompt
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
    if (isIos) {
      setIosHint(true);
      setHidden(false);
      return;
    }

    // Chromium: catch beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Sau khi user accept install
    const installed = () => setHidden(true);
    window.addEventListener('appinstalled', installed);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (hidden) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setHidden(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setHidden(true);
    } else {
      dismiss();
    }
    setDeferredPrompt(null);
  };

  return (
    <div
      role="dialog"
      aria-label="Cài đặt ứng dụng"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-md items-start gap-3 rounded-xl border bg-background p-4 shadow-lg sm:bottom-6 sm:right-6 sm:left-auto sm:mx-0"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {iosHint ? <Share2 className="h-5 w-5" /> : <Download className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Cài Media Ops vào màn hình</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {iosHint ? (
            <>
              Bấm <Share2 className="-mb-0.5 inline h-3 w-3" /> Chia sẻ → "Thêm
              vào màn hình chính" để cài app.
            </>
          ) : (
            'Mở app từ home screen, dùng được offline.'
          )}
        </p>
        {!iosHint && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={install}>
              Cài đặt
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Để sau
            </Button>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Đóng"
        className="-mr-1 -mt-1 h-8 w-8 shrink-0 rounded-md text-muted-foreground hover:bg-muted"
      >
        <X className="mx-auto h-4 w-4" />
      </button>
    </div>
  );
}
