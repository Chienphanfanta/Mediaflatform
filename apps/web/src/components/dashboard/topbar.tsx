// Topbar — 3 mode:
//   mobile (<640) : page title + search icon + notifications + theme. KHÔNG có
//                  MobileSidebar (bottom nav thay thế); KHÔNG có breadcrumb.
//   tablet (≥640) : breadcrumb + search inline + notifications + theme. Sidebar
//                  icon-only collapse bên trái nên không cần Menu trigger.
//   desktop (≥1024): breadcrumb + search wide + notifications + theme.
import { Breadcrumb } from './breadcrumb';
import { GlobalSearch } from './global-search';
import { NotificationBell } from '@/components/layout/notification-bell';
import { PageTitle } from './page-title';
import { ThemeToggle } from './theme-toggle';

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      {/* Mobile: page title chiếm flex-1 */}
      <div className="flex min-w-0 flex-1 items-center sm:hidden">
        <PageTitle />
      </div>

      {/* Tablet+: breadcrumb */}
      <div className="hidden min-w-0 flex-1 items-center sm:flex">
        <Breadcrumb />
      </div>

      <div className="flex items-center gap-1.5">
        <GlobalSearch />
        <ThemeToggle />
        <NotificationBell />
      </div>
    </header>
  );
}
