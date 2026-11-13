'use client';

// /posts/:id — chi tiết bài đăng: trạng thái từng kênh, đăng lại, huỷ, sửa, xoá.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ExternalLink,
  Film,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PostComposer } from '@/components/posts/post-composer';
import { StatusPill, formatVnDateTime } from '@/components/posts/post-status';
import { useCancelPost, useDeletePost, usePost, useRetryTarget } from '@/hooks/use-posts';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import { cn } from '@/lib/utils';

export default function PostDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: post, isLoading, error } = usePost(params.id);
  const retryM = useRetryTarget();
  const cancelM = useCancelPost();
  const deleteM = useDeletePost();
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !post) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error?.message ?? 'Không tìm thấy bài đăng'}</AlertDescription>
      </Alert>
    );
  }

  const locked = post.targets.some((t) => t.status === 'PUBLISHING' || t.status === 'PUBLISHED');
  const hasPending = post.targets.some((t) => t.status === 'PENDING');

  async function run(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Huỷ sửa
        </button>
        <h1 className="text-2xl font-bold tracking-tight">Sửa bài</h1>
        <PostComposer initial={post} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/posts"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Danh sách bài
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold tracking-tight">
            {post.title || 'Bài đăng'}
            <StatusPill status={post.status} />
          </h1>
          <p className="text-xs text-muted-foreground">
            {post.createdBy.name} tạo lúc {formatVnDateTime(post.createdAt)} ·{' '}
            {post.scheduledAt ? `Hẹn đăng ${formatVnDateTime(post.scheduledAt)}` : 'Đăng ngay'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!locked && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Sửa
            </Button>
          )}
          {hasPending && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={cancelM.isPending}
              onClick={() => run(() => cancelM.mutateAsync(post.id))}
            >
              <XCircle className="h-4 w-4" />
              Huỷ đăng
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive"
            disabled={deleteM.isPending}
            onClick={() => {
              if (!confirm('Xoá bài này? Các kênh chưa đăng sẽ bị huỷ.')) return;
              run(async () => {
                await deleteM.mutateAsync(post.id);
                router.push('/posts');
              });
            }}
          >
            <Trash2 className="h-4 w-4" />
            Xoá
          </Button>
        </div>
      </header>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nội dung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="whitespace-pre-wrap text-sm">{post.caption}</p>
            {post.hashtags.length > 0 && (
              <p className="text-sm text-primary">{post.hashtags.join(' ')}</p>
            )}
            {post.media.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {post.media.map((m) =>
                  m.type === 'VIDEO' ? (
                    m.previewUrl ? (
                      <video key={m.id} src={m.previewUrl} controls className="w-full rounded" />
                    ) : (
                      <div key={m.id} className="flex items-center gap-2 rounded border p-2 text-xs">
                        <Film className="h-4 w-4" />
                        {m.fileName}
                      </div>
                    )
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={m.id}
                      src={m.previewUrl}
                      alt={m.fileName}
                      className="aspect-square w-full rounded object-cover"
                    />
                  ),
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kênh đăng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {post.targets.map((t) => (
              <div key={t.id} className="space-y-1.5 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', PLATFORM_DOT[t.channel.platform])} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {t.channel.name}
                  </span>
                  <StatusPill status={t.status} kind="target" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {PLATFORM_LABEL[t.channel.platform]}
                  {t.device && ` · ${t.device.name}`}
                  {t.attempts > 0 && ` · lần thử ${t.attempts}`}
                  {t.publishedAt && ` · ${formatVnDateTime(t.publishedAt)}`}
                </p>
                {t.errorMessage && t.status !== 'PUBLISHED' && (
                  <p className="text-xs text-destructive">{t.errorMessage}</p>
                )}
                <div className="flex gap-2">
                  {t.externalUrl && (
                    <a
                      href={t.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Xem bài
                    </a>
                  )}
                  {(t.status === 'FAILED' || t.status === 'CANCELLED') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      disabled={retryM.isPending}
                      onClick={() =>
                        run(() => retryM.mutateAsync({ postId: post.id, targetId: t.id }))
                      }
                    >
                      {retryM.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      Đăng lại
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
