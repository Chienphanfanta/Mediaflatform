// /settings — index page liệt kê các trang con. Middleware đã gate GROUP_ADMIN+
// trên /settings/* (auth.config.ts ROUTE_RBAC), individual sub-page có gate riêng.
'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  Database,
  KeyRound,
  ListTodo,
  Settings as SettingsIcon,
  Users2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermission } from '@/hooks/use-permission';
import type { EffectiveRole } from '@/lib/rbac';

type SettingItem = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  minRole: EffectiveRole;
  status?: 'active' | 'phase-9'; // phase-9 = chưa implement
};

const SETTINGS: SettingItem[] = [
  {
    href: '/settings/notifications',
    title: 'Thông báo',
    description:
      'Bật/tắt push notifications, email, in-app cho từng loại sự kiện. Quản lý devices đã đăng ký.',
    icon: Bell,
    minRole: 'VIEWER',
    status: 'active',
  },
  {
    href: '/settings/queues',
    title: 'Queue Monitor',
    description:
      'Theo dõi BullMQ jobs realtime — overview cards, 24h timeline, retry/delete inline. Chỉ SuperAdmin.',
    icon: ListTodo,
    minRole: 'SUPERADMIN',
    status: 'active',
  },
  {
    href: '/settings/groups',
    title: 'Nhóm & quyền',
    description:
      'Quản lý groups + members + role permissions. (Phase 9)',
    icon: Users2,
    minRole: 'GROUP_ADMIN',
    status: 'phase-9',
  },
  {
    href: '/settings/integrations',
    title: 'Tích hợp & token',
    description:
      'Rotate OAuth tokens, encryption key, webhook secrets. (Phase 9)',
    icon: KeyRound,
    minRole: 'GROUP_ADMIN',
    status: 'phase-9',
  },
  {
    href: '/settings/database',
    title: 'Cơ sở dữ liệu',
    description:
      'Backup, migration status, soft-delete cleanup. (Phase 9)',
    icon: Database,
    minRole: 'SUPERADMIN',
    status: 'phase-9',
  },
];

export default function SettingsIndexPage() {
  const { atLeast } = usePermission();

  // Filter theo role hiện tại (middleware đã filter /settings/* nhưng card cũng tự ẩn)
  const visible = SETTINGS.filter((s) => atLeast(s.minRole));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          <SettingsIcon className="mr-2 inline h-7 w-7" />
          Cài đặt
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quản lý preferences, integrations, và system configuration.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <SettingCard key={s.href} item={s} />
        ))}
      </div>

      {visible.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Bạn không có quyền truy cập trang cài đặt nào. Liên hệ quản trị viên
            nếu cần.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SettingCard({ item }: { item: SettingItem }) {
  const isPhase9 = item.status === 'phase-9';
  const Icon = item.icon;

  const card = (
    <Card
      className={`group h-full transition-all ${
        isPhase9
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:border-primary/40 hover:shadow-md'
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          {isPhase9 && (
            <Badge variant="secondary" className="text-[10px]">
              Phase 9
            </Badge>
          )}
          {!isPhase9 && (
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          )}
        </div>
        <CardTitle className="mt-3 text-base">{item.title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {item.description}
      </CardContent>
    </Card>
  );

  if (isPhase9) return card;
  return <Link href={item.href}>{card}</Link>;
}
