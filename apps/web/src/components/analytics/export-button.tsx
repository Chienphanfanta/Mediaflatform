// Export button — desktop: dropdown CSV/JSON; mobile: 2 nút Chia sẻ + CSV.
//
// Web Share API (navigator.share) chỉ chạy ở Secure context (HTTPS hoặc
// localhost) + iOS Safari/Chrome Android. Fallback copy-link nếu không support.
'use client';

import { useState } from 'react';
import { Download, Share2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AnalyticsPeriodState } from '@/hooks/use-analytics-summary';

type Props = {
  /** Để build query string cho /api/v1/analytics/export */
  period: AnalyticsPeriodState;
};

export function ExportButton({ period }: Props) {
  const [busy, setBusy] = useState(false);

  const exportUrl = (format: 'csv' | 'json') => {
    const url = new URL('/api/v1/analytics/export', window.location.origin);
    url.searchParams.set('format', format);
    if (period.mode === 'preset' && period.period) {
      url.searchParams.set('preset', period.period);
    }
    if (period.mode === 'custom') {
      if (period.from) url.searchParams.set('from', period.from);
      if (period.to) url.searchParams.set('to', period.to);
    }
    return url.toString();
  };

  const downloadCsv = async () => {
    setBusy(true);
    try {
      // Trigger native download — browser xử lý
      const a = document.createElement('a');
      a.href = exportUrl('csv');
      a.download = `analytics-${todayFmt()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const url = window.location.href;
      const title = 'Analytics — Media Ops';
      const text = 'Xem báo cáo analytics tổng hợp các kênh truyền thông.';

      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title, text, url });
          return;
        } catch (e) {
          // User cancel sẽ throw AbortError — không cần fallback
          if ((e as DOMException)?.name === 'AbortError') return;
          // Lỗi khác → fallback copy
        }
      }
      // Fallback: copy URL vào clipboard
      try {
        await navigator.clipboard.writeText(url);
        alert('Đã copy link vào clipboard');
      } catch {
        alert('Không share được — trình duyệt không hỗ trợ.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Mobile: 2 nút riêng biệt */}
      <div className="flex gap-2 sm:hidden">
        <Button
          size="sm"
          variant="outline"
          onClick={share}
          disabled={busy}
          aria-label="Chia sẻ"
        >
          <Share2 className="h-4 w-4" />
          Chia sẻ
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={downloadCsv}
          disabled={busy}
          aria-label="Tải CSV"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          CSV
        </Button>
      </div>

      {/* Tablet+: dropdown gộp với cả CSV và JSON */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            className="hidden sm:inline-flex"
          >
            <Download className="h-4 w-4" />
            Xuất
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={downloadCsv}>
            <Download className="mr-2 h-4 w-4" />
            Tải CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              const a = document.createElement('a');
              a.href = exportUrl('json');
              a.download = `analytics-${todayFmt()}.json`;
              a.click();
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Tải JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={share}>
            <Share2 className="mr-2 h-4 w-4" />
            Chia sẻ link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function todayFmt(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
