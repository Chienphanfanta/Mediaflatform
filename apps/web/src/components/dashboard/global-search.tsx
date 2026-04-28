// Global search — 2 mode:
//   - Tablet/desktop (md+): inline input với ⌘K shortcut
//   - Mobile (<md): icon button → fullscreen Sheet overlay với input lớn
'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';

export function GlobalSearch() {
  const inlineRef = useRef<HTMLInputElement>(null);
  const fullscreenRef = useRef<HTMLInputElement>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  // ⌘K / Ctrl+K — focus inline (md+) hoặc mở overlay (mobile)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.innerWidth >= 768) {
          inlineRef.current?.focus();
        } else {
          setOverlayOpen(true);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-focus khi mở overlay
  useEffect(() => {
    if (overlayOpen) {
      // Delay để Sheet animation xong
      const t = setTimeout(() => fullscreenRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [overlayOpen]);

  return (
    <>
      {/* Inline (tablet+) */}
      <div className="relative hidden md:block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inlineRef}
          type="search"
          placeholder="Tìm kiếm..."
          className="h-9 w-48 pl-8 pr-12 lg:w-72"
          aria-label="Tìm kiếm toàn cục"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </div>

      {/* Icon trigger (mobile only) */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOverlayOpen(true)}
        aria-label="Mở tìm kiếm"
        className="md:hidden"
      >
        <Search className="h-5 w-5" />
      </Button>

      {/* Fullscreen overlay (mobile only) */}
      <Sheet open={overlayOpen} onOpenChange={setOverlayOpen}>
        <SheetContent side="top" className="h-full p-0 md:hidden">
          <SheetTitle className="sr-only">Tìm kiếm</SheetTitle>
          <SheetDescription className="sr-only">
            Nhập từ khoá để tìm bài, kênh, nhân sự
          </SheetDescription>
          <div className="flex h-16 items-center gap-2 border-b px-3">
            <Search className="h-5 w-5 text-muted-foreground" />
            <Input
              ref={fullscreenRef}
              type="search"
              placeholder="Tìm bài, kênh, nhân sự..."
              className="h-11 flex-1 border-0 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label="Tìm kiếm"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOverlayOpen(false)}
              aria-label="Đóng"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground">
            Gõ ít nhất 2 ký tự để bắt đầu tìm.
            {/* Phase 8: kết nối cmdk + endpoint /api/v1/search (issue #12) */}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
