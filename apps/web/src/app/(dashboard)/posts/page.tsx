'use client';

// /posts — danh sách bài đăng qua browser extension.
import { useState } from 'react';
import Link from 'next/link';
import type { PostStatus } from '@prisma/client';
import { ChevronLeft, ChevronRight, Film, Image as ImageIcon, Laptop, Plus, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { POST_STATUS_LABEL, StatusPill, formatVnDateTime } from '@/components/posts/post-status';
import { usePosts } from '@/hooks/use-posts';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import { cn } from '@/lib/utils';

const FILTERS: Array<{ value: PostStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'SCHEDULED', label: POST_STATUS_LABEL.SCHEDULED },
  { value: 'PUBLISHING', label: POST_STATUS_LABEL.PUBLISHING },
  { value: 'PUBLISHED', label: POST_STATUS_LABEL.PUBLISHED },
  { value: 'FAILED', label: POST_STATUS_LABEL.FAILED },
  { value: 'PARTIAL', label: POST_STATUS_LABEL.PARTIAL },
  { value: 'DRAFT', label: POST_STATUS_LABEL.DRAFT },
];

export default function PostsPage() {
  const [status, setStatus] = useState<PostStatus | 'ALL'>('ALL');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = usePosts({
    status: status === 'ALL' ? undefined : status,
    mine,
    page,
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Send className="h-7 w-7" />
            Đăng bài
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Soạn bài, hẹn giờ — extension trên trình duyệt của nhân viên phụ trách kênh sẽ tự đăng.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link href="/posts/devices">
              <Laptop className="h-4 w-4" />
              Trình duyệt
            </Link>
          </Button>
          <Button asChild className="gap-2">
            <Link href="/posts/new">
              <Plus className="h-4 w-4" />
              Soạn bài
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setStatus(f.value);
              setPage(1);
            }}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              status === f.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'hover:bg-accent',
            )}
          >
            {f.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked);
              setPage(1);
            }}
          />
          Chỉ bài tôi tạo
        </label>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">{error.message}</CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Send className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Chưa có bài đăng nào.</p>
            <Button asChild size="sm">
              <Link href="/posts/new">Soạn bài đầu tiên</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data?.items.map((p) => {
            const video = p.media.some((m) => m.type === 'VIDEO');
            return (
              <Link key={p.id} href={`/posts/${p.id}`} className="block">
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StatusPill status={p.status} />
                        {p.media.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            {video ? (
                              <Film className="h-3.5 w-3.5" />
                            ) : (
                              <ImageIcon className="h-3.5 w-3.5" />
                            )}
                            {p.media.length}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">
                        {p.title || p.caption}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.createdBy.name} ·{' '}
                        {p.scheduledAt
                          ? `Hẹn ${formatVnDateTime(p.scheduledAt)}`
                          : 'Đăng ngay khi trình duyệt online'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.targets.map((t) => (
                        <span
                          key={t.id}
                          title={`${t.channel.name} — ${t.status}`}
                          className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
                        >
                          <span
                            className={cn('h-2 w-2 rounded-full', PLATFORM_DOT[t.channel.platform])}
                          />
                          <span className="max-w-[120px] truncate">{t.channel.name}</span>
                          <StatusPill status={t.status} kind="target" className="px-1.5" />
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>
            {page}/{data.pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Nền tảng hỗ trợ: {Object.values(PLATFORM_LABEL).join(', ')}.
      </p>
    </div>
  );
}
