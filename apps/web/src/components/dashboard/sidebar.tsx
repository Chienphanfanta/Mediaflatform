// Sidebar — 3 mode theo viewport:
//   mobile (<640) : ẨN HOÀN TOÀN — Bottom nav thay thế (xem layout.tsx)
//   tablet (≥640) : icon-only 60px, hover/focus-within expand 240px
//   desktop (≥1024): cố định 240px (default)
//
// Dùng group + group-hover + transition CSS thuần — không cần JS state.
import Link from 'next/link';
import { Activity } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { NavItems } from './nav-items';
import { UserMenu } from './user-menu';

export function Sidebar() {
  return (
    <aside
      // hidden mobile / icon-only tablet / full desktop
      className="group/sidebar fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-card transition-[width] duration-200 sm:flex sm:w-[60px] sm:hover:w-60 sm:focus-within:w-60 lg:w-60 lg:hover:w-60"
      aria-label="Sidebar"
    >
      <Link
        href="/dashboard"
        className="flex h-16 items-center gap-2.5 px-4 transition-opacity hover:opacity-80 lg:px-6"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Activity className="h-5 w-5" />
        </div>
        <div className="flex flex-col leading-tight overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100 lg:opacity-100">
          <span className="text-sm font-bold">Media Ops</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Platform
          </span>
        </div>
      </Link>
      <Separator />
      <div className="flex-1 overflow-y-auto py-4">
        <NavItems collapsed />
      </div>
      <Separator />
      <div className="p-2 lg:p-3">
        <UserMenu />
      </div>
    </aside>
  );
}
