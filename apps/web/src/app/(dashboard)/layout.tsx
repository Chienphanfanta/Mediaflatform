// Dashboard shell:
//   mobile  (<640) : KHÔNG sidebar — BottomNav cố định ở đáy (64px + safe-area)
//   tablet  (≥640) : Sidebar icon-only 60px (hover expand 240px)
//   desktop (≥1024): Sidebar full 240px cố định
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { BottomNav } from '@/components/dashboard/bottom-nav';
import { DocumentTitleSync } from '@/components/dashboard/page-title';
import { Sidebar } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Belt-and-suspenders: middleware đã redirect, nhưng nếu lọt thì vẫn chặn ở đây.
  const session = await auth();
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen bg-muted/30">
      <DocumentTitleSync />
      <Sidebar />
      <BottomNav />
      <div className="flex flex-col sm:pl-[60px] lg:pl-60">
        <Topbar />
        {/* pb-20 mobile: chừa 64px BottomNav + 16px buffer (env safe-area trong BottomNav) */}
        <main className="flex-1 p-4 pb-20 sm:p-6 sm:pb-6 lg:p-8 lg:pb-8">
          {children}
        </main>
      </div>
    </div>
  );
}
