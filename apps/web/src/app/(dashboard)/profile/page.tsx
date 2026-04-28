// /profile — trang cá nhân của user đang login.
// Server component: lấy session → render basic info + link điều hướng.
// Detail metrics dùng cùng nguồn /api/v1/users/[id] (xem /hr/[id]).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowRight,
  Bell,
  LayoutDashboard,
  LogOut,
  Settings as SettingsIcon,
  Shield,
  User,
} from 'lucide-react';

import { auth, signOut } from '@/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { getEffectiveRole, type EffectiveRole } from '@/lib/rbac';

const ROLE_LABEL: Record<EffectiveRole, string> = {
  SUPERADMIN: 'Super Admin',
  GROUP_ADMIN: 'Group Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
  VIEWER: 'Viewer',
};

const GROUP_ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
  VIEWER: 'Viewer',
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user = session.user;
  const effectiveRole = getEffectiveRole(user);
  const initials = (user.name ?? user.email ?? 'U').slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          <User className="mr-2 inline h-7 w-7" />
          Trang cá nhân
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Thông tin tài khoản của bạn + đường tắt quản lý preferences.
        </p>
      </header>

      {/* Profile card */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user.image ?? undefined} />
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-xl">
                {user.name ?? 'Chưa đặt tên'}
              </CardTitle>
              <CardDescription>{user.email}</CardDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {effectiveRole && (
                  <Badge variant="secondary">
                    <Shield className="mr-1 h-3 w-3" />
                    {ROLE_LABEL[effectiveRole]}
                  </Badge>
                )}
                {user.isSuperAdmin && (
                  <Badge variant="default">Super Admin (toàn quyền)</Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Separator />

          <div>
            <h3 className="mb-2 text-sm font-medium">Nhóm tham gia</h3>
            {user.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Bạn chưa thuộc nhóm nào.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {user.groups.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{g.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {GROUP_ROLE_LABEL[g.role] ?? g.role}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ActionCard
          href="/settings/notifications"
          icon={Bell}
          title="Thông báo"
          description="Bật/tắt push, email, in-app cho từng loại sự kiện."
        />
        <ActionCard
          href="/settings"
          icon={SettingsIcon}
          title="Cài đặt"
          description="Toàn bộ trang cấu hình app."
        />
        {effectiveRole && ['MANAGER', 'GROUP_ADMIN', 'SUPERADMIN'].includes(effectiveRole) && (
          <ActionCard
            href={`/hr/${user.id}`}
            icon={LayoutDashboard}
            title="Hồ sơ KPI"
            description="Xem aggregate metrics 30 ngày — posts, tasks, KPI."
          />
        )}
      </div>

      {/* Logout */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-medium">Đăng xuất</p>
            <p className="text-xs text-muted-foreground">
              Kết thúc phiên đăng nhập trên thiết bị này.
            </p>
          </div>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <Button type="submit" variant="outline">
              <LogOut className="h-4 w-4" />
              Đăng xuất
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ActionCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof Bell;
  title: string;
  description: string;
}) {
  return (
    <Link href={href}>
      <Card className="group h-full cursor-pointer transition-all hover:border-primary/40 hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <CardTitle className="mt-3 text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {description}
        </CardContent>
      </Card>
    </Link>
  );
}
