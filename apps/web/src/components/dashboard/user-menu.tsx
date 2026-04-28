'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { LogOut, User as UserIcon, Settings as SettingsIcon, ChevronUp } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePermission } from '@/hooks/use-permission';
import type { EffectiveRole } from '@/lib/rbac';

function initials(name?: string | null): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '');
}

const ROLE_LABEL: Record<EffectiveRole, string> = {
  SUPERADMIN: 'Super Admin',
  GROUP_ADMIN: 'Group Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
  VIEWER: 'Viewer',
};

export function UserMenu() {
  const { user, effectiveRole, isLoading } = usePermission();

  if (isLoading || !user) {
    return <div className="h-12 w-full animate-pulse rounded-md bg-muted/50" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md p-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="h-9 w-9">
            {user.image && <AvatarImage src={user.image} alt={user.name ?? ''} />}
            <AvatarFallback>{initials(user.name).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.name ?? user.email}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="top" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-1.5 pb-2">
          <span className="truncate text-sm">{user.name ?? user.email}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
          {effectiveRole && (
            <Badge variant="secondary" className="mt-1 w-fit">
              {ROLE_LABEL[effectiveRole]}
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <UserIcon className="mr-2 h-4 w-4" />
              Trang cá nhân
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <SettingsIcon className="mr-2 h-4 w-4" />
              Cài đặt
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
