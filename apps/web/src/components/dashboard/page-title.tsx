// PageTitle (mobile topbar) — derive label từ pathname segment cuối.
// Side effect: cũng cập nhật document.title cho tab browser.
//
// Initial HTML SSR vẫn có "Media Ops Platform" (set ở app/layout.tsx metadata).
// Sau hydration, useEffect set lại document.title theo route hiện tại — UX tab
// browser dễ phân biệt khi user mở nhiều tab.
'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const LABELS: Record<string, string> = {
  dashboard: 'Tổng quan',
  hr: 'Nhân sự',
  calendar: 'Content Calendar',
  channels: 'Kênh truyền thông',
  analytics: 'Analytics',
  reports: 'Báo cáo',
  settings: 'Cài đặt',
  review: 'Review Queue',
  alerts: 'Cảnh báo',
  failed: 'Bài thất bại',
  queues: 'Queue Monitor',
  notifications: 'Thông báo',
  connect: 'Kết nối kênh',
  profile: 'Trang cá nhân',
};

const SITE_NAME = 'Media Ops Platform';

function humanize(seg: string): string {
  if (LABELS[seg]) return LABELS[seg];
  if (/^[a-z0-9]{20,}$/i.test(seg)) return seg.slice(0, 8) + '…';
  return seg;
}

function deriveTitle(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'dashboard';
  return humanize(last);
}

/** Hook side-effect: chỉ set document.title, không render. Dùng trong layout. */
export function useDocumentTitle(): void {
  const pathname = usePathname();
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const label = deriveTitle(pathname);
    document.title =
      label === SITE_NAME ? SITE_NAME : `${label} — ${SITE_NAME}`;
  }, [pathname]);
}

/** Component cho mobile topbar — kèm side effect document.title (dual-purpose). */
export function PageTitle() {
  useDocumentTitle();
  const pathname = usePathname();
  const label = deriveTitle(pathname);
  return <h1 className="truncate text-base font-semibold">{label}</h1>;
}

/** Side-effect-only component — mount trong layout cho desktop (nơi không render PageTitle). */
export function DocumentTitleSync() {
  useDocumentTitle();
  return null;
}
