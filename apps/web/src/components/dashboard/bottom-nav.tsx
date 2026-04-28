// Bottom navigation — chỉ hiện trên mobile (<640px).
// V2 Day 5: 5 tab spec — Dashboard | Nhân sự | Kênh | KPI | Menu.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Menu as MenuIcon,
  Radio,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { NavItems } from './nav-items';
import { UserMenu } from './user-menu';

type Tab = {
  href?: string;
  label: string;
  icon: LucideIcon;
  isMenu?: boolean;
};

const TABS: Tab[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/employees', label: 'Nhân sự', icon: Users },
  { href: '/channels', label: 'Kênh', icon: Radio },
  { href: '/kpi', label: 'KPI', icon: Target },
  { label: 'Menu', icon: MenuIcon, isMenu: true },
];

export function BottomNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Đóng menu sheet khi điều hướng
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t bg-background sm:hidden"
        aria-label="Bottom navigation"
        // safe-area cho iPhone notch
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {TABS.map((tab) => {
          const active = tab.href
            ? pathname === tab.href || pathname.startsWith(tab.href + '/')
            : false;
          const Icon = tab.icon;
          const baseCls =
            'flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors';
          const stateCls = active
            ? 'text-primary'
            : 'text-muted-foreground hover:text-foreground';
          if (tab.isMenu) {
            return (
              <button
                key="menu"
                type="button"
                onClick={() => setMenuOpen(true)}
                className={cn(baseCls, 'min-h-[44px]', stateCls)}
                aria-label="Mở menu đầy đủ"
              >
                <Icon className="h-5 w-5" />
                <span>{tab.label}</span>
              </button>
            );
          }
          return (
            <Link
              key={tab.href}
              href={tab.href!}
              aria-current={active ? 'page' : undefined}
              className={cn(baseCls, 'min-h-[44px]', stateCls)}
            >
              <Icon className="h-5 w-5" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="bottom"
          className="h-[80vh] rounded-t-xl p-0 sm:hidden"
        >
          <div className="flex h-full flex-col">
            <SheetTitle className="px-6 py-4 text-lg">Menu</SheetTitle>
            <SheetDescription className="sr-only">
              Tất cả mục điều hướng
            </SheetDescription>
            <Separator />
            <div className="flex-1 overflow-y-auto py-4">
              <NavItems onNavigate={() => setMenuOpen(false)} />
            </div>
            <Separator />
            <div className="p-3">
              <UserMenu />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
