import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = { title: '403 — Không có quyền' };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-6 text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Không có quyền truy cập</h1>
          <p className="text-muted-foreground">
            Tài khoản của bạn không đủ quyền xem trang này. Vui lòng liên hệ quản trị viên
            nếu đây là nhầm lẫn.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/dashboard">Về dashboard</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/login">Đổi tài khoản</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
