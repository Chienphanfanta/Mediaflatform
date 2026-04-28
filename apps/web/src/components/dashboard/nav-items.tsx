'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Tv,
  BarChart3,
  Bell,
  FileText,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermission } from '@/hooks/use-permission';
import type { EffectiveRole } from '@/lib/rbac';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  minRole: EffectiveRole;
};

// Khớp với ROUTE_RBAC ở auth.config.ts — middleware cũng kiểm tra cùng tập rule.
const NAV_ITEMS: NavItem[] = [
  // V2 nav: bỏ /calendar và /review (post creation + workflow approval — V2 read-only).
  // /hr giữ tạm để map sang /employees ở Sprint 6.
  { href: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard, minRole: 'VIEWER' },
  { href: '/hr', label: 'Nhân sự', icon: Users, minRole: 'MANAGER' },
  { href: '/channels', label: 'Kênh truyền thông', icon: Tv, minRole: 'STAFF' },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, minRole: 'VIEWER' },
  { href: '/alerts', label: 'Cảnh báo', icon: Bell, minRole: 'VIEWER' },
  { href: '/reports', label: 'Báo cáo', icon: FileText, minRole: 'MANAGER' },
  { href: '/settings', label: 'Cài đặt', icon: Settings, minRole: 'GROUP_ADMIN' },
];

export function NavItems({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  /**
   * Khi true: ẩn label ở viewport tablet (≥640 < 1024) cho sidebar icon-only.
   * Label hiện lại trên hover qua group/sidebar (ở Sidebar component).
   * Desktop (lg+) luôn show label.
   */
  collapsed?: boolean;
}) {
  const { atLeast, isLoading } = usePermission();
  const pathname = usePathname();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 px-2 lg:px-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <nav className="flex flex-col gap-1 px-2 lg:px-3" aria-label="Main">
      {NAV_ITEMS.map((item) => {
        if (!atLeast(item.minRole)) return null;
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              'group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5 shrink-0',
                active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
              )}
            />
            <span
              className={cn(
                'truncate whitespace-nowrap',
                collapsed
                  ? 'opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100 lg:opacity-100'
                  : '',
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
