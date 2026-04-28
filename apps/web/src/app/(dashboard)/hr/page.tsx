// /hr — list nhân sự (Manager+ only).
// Click row → /hr/[id] xem chi tiết tổng hợp 30 ngày.
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Search, Users } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { HRUserListItem } from '@/lib/types/hr';

export default function HRPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery<{
    items: HRUserListItem[];
    total: number;
  }>({
    queryKey: ['hr-users'],
    queryFn: async () => {
      const r = await fetch('/api/v1/users');
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message ?? 'Lỗi tải nhân sự');
      return j.data;
    },
  });

  const items = (data?.items ?? []).filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.groups.some((g) => g.name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Nhân sự</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Danh sách thành viên trong các nhóm bạn quản lý — KPI 30 ngày.
            {data && ` · ${data.total} người`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Tìm tên, email, nhóm..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-64 pl-8"
            />
          </div>
          <Button disabled title="Phase 9 — chưa hỗ trợ tạo user qua UI">
            + Thêm thành viên
          </Button>
        </div>
      </header>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Không tải được danh sách</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message ?? 'Lỗi không xác định.'}
            <Button
              size="sm"
              variant="outline"
              className="ml-2"
              onClick={() => refetch()}
            >
              Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Nhân sự</th>
                  <th className="px-4 py-3 font-medium">Vai trò</th>
                  <th className="px-4 py-3 font-medium">Nhóm</th>
                  <th className="w-24 px-4 py-3 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={4} className="p-2">
                        <Skeleton className="h-12 w-full" />
                      </td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-12 text-center text-sm text-muted-foreground"
                    >
                      <Users className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      {search
                        ? 'Không khớp tìm kiếm.'
                        : 'Chưa có nhân sự nào trong nhóm bạn quản lý.'}
                    </td>
                  </tr>
                ) : (
                  items.map((u) => (
                    <UserRow key={u.id} user={u} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UserRow({ user }: { user: HRUserListItem }) {
  return (
    <tr className="transition-colors hover:bg-accent/40">
      <td className="px-4 py-3">
        <Link
          href={`/hr/${user.id}`}
          className="flex items-center gap-3 hover:underline"
        >
          <Avatar className="h-9 w-9">
            <AvatarImage src={user.avatar ?? undefined} />
            <AvatarFallback>
              {user.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {user.email}
            </div>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className="text-xs">
          {user.primaryRole}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {user.groups.map((g) => (
            <Badge key={g.id} variant="secondary" className="text-[10px]">
              {g.name}
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/hr/${user.id}`}>Chi tiết →</Link>
        </Button>
      </td>
    </tr>
  );
}
