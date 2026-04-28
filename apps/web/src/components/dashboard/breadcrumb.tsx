'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

// Map segment URL → label tiếng Việt. Segment chưa có mặc định dùng nguyên văn.
const LABELS: Record<string, string> = {
  dashboard: 'Tổng quan',
  hr: 'Nhân sự',
  calendar: 'Content Calendar',
  channels: 'Kênh truyền thông',
  analytics: 'Analytics',
  reports: 'Báo cáo',
  settings: 'Cài đặt',
  profile: 'Trang cá nhân',
  posts: 'Bài đăng',
  tasks: 'Công việc',
  groups: 'Nhóm',
  new: 'Tạo mới',
  edit: 'Chỉnh sửa',
};

function humanize(seg: string): string {
  if (LABELS[seg]) return LABELS[seg];
  // ID dạng cuid/uuid → rút gọn
  if (/^[a-z0-9]{20,}$/i.test(seg)) return seg.slice(0, 8) + '…';
  return seg;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  return (
    <nav className="flex items-center gap-1.5 text-sm" aria-label="Breadcrumb">
      <Link
        href="/dashboard"
        className="flex items-center text-muted-foreground transition-colors hover:text-foreground"
      >
        <Home className="h-4 w-4" />
        <span className="sr-only">Trang chủ</span>
      </Link>
      {segments.map((seg, i) => {
        const href = '/' + segments.slice(0, i + 1).join('/');
        const isLast = i === segments.length - 1;
        const label = humanize(seg);
        return (
          <span key={href} className="flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            {isLast ? (
              <span className="font-medium text-foreground">{label}</span>
            ) : (
              <Link
                href={href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
