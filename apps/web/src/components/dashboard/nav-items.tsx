'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bell,
  Building2,
  FileText,
  LayoutDashboard,
  Radio,
  Settings,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { PermissionGate } from '@/components/auth/permission-gate';
import { cn } from '@/lib/utils';
import type { EffectiveRole } from '@/lib/rbac';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  minRole: EffectiveRole;
};

// Khớp với ROUTE_RBAC ở auth.config.ts.
// V2 Day 5: rebrand từ V1 Media Ops sang HR + Channel Tracker.
//   - Calendar / Review / Media: bỏ Day 1 (V2 read-only)
//   - /hr → /employees (rename Day 5)
//   - /departments + /kpi: placeholder Sprint 6
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, minRole: 'VIEWER' },
  { href: '/employees', label: 'Nhân sự', icon: Users, minRole: 'MANAGER' },
  { href: '/departments', label: 'Phòng ban', icon: Building2, minRole: 'STAFF' },
  { href: '/channels', label: 'Kênh truyền thông', icon: Radio, minRole: 'STAFF' },
  { href: '/kpi', label: 'KPI', icon: Target, minRole: 'STAFF' },
  { href: '/analytics', label: 'Tăng trưởng', icon: BarChart3, minRole: 'VIEWER' },
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
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-2 lg:px-3" aria-label="Main">
      {NAV_ITEMS.map((item) => (
        <PermissionGate
          key={item.href}
          minRole={item.minRole}
          loadingFallback={
            <div className="h-10 rounded-md bg-muted/50 animate-pulse" />
          }
        >
          <NavLink
            item={item}
            active={
              pathname === item.href || pathname.startsWith(item.href + '/')
            }
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
        </PermissionGate>
      ))}
    </nav>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
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
          active
            ? 'text-primary'
            : 'text-muted-foreground group-hover:text-foreground',
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
}
