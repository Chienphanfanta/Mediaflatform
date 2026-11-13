'use client';

// Form soạn bài: nội dung, media (upload MinIO), chọn kênh, hẹn giờ.
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CalendarClock,
  Film,
  Image as ImageIcon,
  Loader2,
  Send,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatBytes, toDateTimeLocal } from '@/components/posts/post-status';
import {
  type PostItem,
  type PostPayload,
  uploadMedia,
  useCreatePost,
  usePostableChannels,
  useUpdatePost,
} from '@/hooks/use-posts';
import { ApiClientError } from '@/lib/api-client';
import { PLATFORM_DOT, PLATFORM_LABEL } from '@/lib/platform';
import { cn } from '@/lib/utils';

type MediaState = {
  key: string;
  id?: string;
  fileName: string;
  sizeBytes: number;
  type: 'IMAGE' | 'VIDEO';
  previewUrl?: string;
  progress: number;
  error?: string;
};

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm';

export function PostComposer({ initial }: { initial?: PostItem }) {
  const router = useRouter();
  const channelsQ = usePostableChannels();
  const createM = useCreatePost();
  const updateM = useUpdatePost(initial?.id ?? '');
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [caption, setCaption] = useState(initial?.caption ?? '');
  const [hashtags, setHashtags] = useState(initial?.hashtags.join(' ') ?? '');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>(
    initial?.scheduledAt ? 'later' : 'now',
  );
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocal(initial?.scheduledAt));
  const [channelIds, setChannelIds] = useState<string[]>(
    initial?.targets.filter((t) => t.status !== 'CANCELLED').map((t) => t.channel.id) ?? [],
  );
  const [privacy, setPrivacy] = useState<'public' | 'private' | 'unlisted'>('public');
  const [media, setMedia] = useState<MediaState[]>(
    initial?.media.map((m) => ({
      key: m.id,
      id: m.id,
      fileName: m.fileName,
      sizeBytes: m.sizeBytes,
      type: m.type,
      previewUrl: m.previewUrl,
      progress: 100,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const channels = useMemo(() => channelsQ.data?.items ?? [], [channelsQ.data]);
  const selected = channels.filter((c) => channelIds.includes(c.id));
  const platforms = new Set(selected.map((c) => c.platform));
  const uploading = media.some((m) => !m.id && !m.error);
  const hasVideo = media.some((m) => m.type === 'VIDEO');
  const pending = createM.isPending || updateM.isPending;

  // Cảnh báo sớm theo nền tảng (server cũng kiểm tra lại)
  const warnings: string[] = [];
  if (platforms.has('YOUTUBE') && !hasVideo) warnings.push('YouTube cần 1 video.');
  if (platforms.has('YOUTUBE') && !title.trim()) warnings.push('YouTube cần tiêu đề video.');
  if (platforms.has('TIKTOK') && media.length === 0) warnings.push('TikTok cần video hoặc ảnh.');
  const noBrowser = selected.filter((c) => !c.hasBrowser);

  function toggleChannel(id: string) {
    setChannelIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      const type = file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE';
      setMedia((cur) => [
        ...cur,
        { key, fileName: file.name, sizeBytes: file.size, type, progress: 0 },
      ]);
      try {
        const up = await uploadMedia(file, (progress) =>
          setMedia((cur) => cur.map((m) => (m.key === key ? { ...m, progress } : m))),
        );
        setMedia((cur) =>
          cur.map((m) =>
            m.key === key ? { ...m, id: up.id, previewUrl: up.previewUrl, progress: 100 } : m,
          ),
        );
      } catch (e) {
        setMedia((cur) =>
          cur.map((m) => (m.key === key ? { ...m, error: (e as Error).message } : m)),
        );
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit(draft: boolean) {
    setError(null);
    if (scheduleMode === 'later' && !scheduledAt) {
      setError('Chọn thời gian hẹn đăng');
      return;
    }
    const payload: PostPayload = {
      title: title.trim() || null,
      caption,
      hashtags: hashtags
        .split(/[\s,]+/)
        .map((h) => h.trim())
        .filter(Boolean),
      scheduledAt: scheduleMode === 'later' ? new Date(scheduledAt).toISOString() : null,
      mediaIds: media.filter((m) => m.id).map((m) => m.id as string),
      channelIds,
      options: { privacy },
      draft,
    };
    try {
      const post = initial ? await updateM.mutateAsync(payload) : await createM.mutateAsync(payload);
      router.push(`/posts/${post.id}`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : (e as Error).message);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nội dung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="title">
                Tiêu đề <span className="text-xs text-muted-foreground">(bắt buộc với YouTube)</span>
              </Label>
              <Input
                id="title"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Tiêu đề video YouTube"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="caption">Nội dung / mô tả *</Label>
              <Textarea
                id="caption"
                rows={7}
                maxLength={5000}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Viết nội dung bài đăng..."
              />
              <p className="text-right text-[11px] text-muted-foreground">{caption.length}/5000</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hashtags">Hashtag</Label>
              <Input
                id="hashtags"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                placeholder="#tintuc #giaitri"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Ảnh / video</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Chọn file
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
          </CardHeader>
          <CardContent>
            {media.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Chưa có file. 1 bài gồm 1 video, hoặc tối đa 10 ảnh.
              </p>
            ) : (
              <ul className="space-y-2">
                {media.map((m) => (
                  <li key={m.key} className="flex items-center gap-3 rounded-md border p-2">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                      {m.type === 'IMAGE' && m.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.previewUrl} alt="" className="h-full w-full object-cover" />
                      ) : m.type === 'VIDEO' ? (
                        <Film className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{m.fileName}</p>
                      {m.error ? (
                        <p className="text-xs text-destructive">{m.error}</p>
                      ) : m.id ? (
                        <p className="text-xs text-muted-foreground">{formatBytes(m.sizeBytes)}</p>
                      ) : (
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${m.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setMedia((cur) => cur.filter((x) => x.key !== m.key))}
                      aria-label="Bỏ file"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kênh đăng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {channelsQ.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {channels.length === 0 && !channelsQ.isLoading && (
              <p className="text-sm text-muted-foreground">
                Bạn chưa phụ trách kênh nào để đăng bài.
              </p>
            )}
            {channels.map((c) => (
              <label
                key={c.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm',
                  channelIds.includes(c.id) && 'border-primary bg-primary/5',
                )}
              >
                <Checkbox
                  checked={channelIds.includes(c.id)}
                  onCheckedChange={() => toggleChannel(c.id)}
                />
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', PLATFORM_DOT[c.platform])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {PLATFORM_LABEL[c.platform]}
                    {' · '}
                    {c.browserOnline ? (
                      <span className="text-emerald-600">trình duyệt online</span>
                    ) : c.hasBrowser ? (
                      'trình duyệt offline'
                    ) : (
                      <span className="text-amber-600">chưa có trình duyệt</span>
                    )}
                  </span>
                </span>
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" />
              Thời gian đăng
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={scheduleMode === 'now'}
                onChange={() => setScheduleMode('now')}
              />
              Đăng ngay khi trình duyệt online
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={scheduleMode === 'later'}
                onChange={() => setScheduleMode('later')}
              />
              Hẹn giờ
            </label>
            {scheduleMode === 'later' && (
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            )}
            {(platforms.has('YOUTUBE') || platforms.has('TIKTOK')) && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="privacy">Chế độ hiển thị (YouTube/TikTok)</Label>
                <select
                  id="privacy"
                  value={privacy}
                  onChange={(e) => setPrivacy(e.target.value as typeof privacy)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="public">Công khai</option>
                  <option value="unlisted">Không công khai (YouTube)</option>
                  <option value="private">Riêng tư</option>
                </select>
              </div>
            )}
          </CardContent>
        </Card>

        {(warnings.length > 0 || noBrowser.length > 0) && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="space-y-1 text-xs">
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              {noBrowser.length > 0 && (
                <p className="flex items-start gap-1">
                  <WifiOff className="mt-0.5 h-3 w-3 shrink-0" />
                  {noBrowser.map((c) => c.name).join(', ')}: người phụ trách chưa cài extension —
                  bài sẽ chờ đến khi có trình duyệt.
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Button
            onClick={() => submit(false)}
            disabled={pending || uploading || !caption.trim() || channelIds.length === 0}
            className="gap-2"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {scheduleMode === 'later' ? 'Lên lịch đăng' : 'Đưa vào hàng chờ đăng'}
          </Button>
          <Button
            variant="outline"
            onClick={() => submit(true)}
            disabled={pending || uploading || !caption.trim() || channelIds.length === 0}
          >
            Lưu nháp
          </Button>
          {uploading && (
            <p className="text-center text-xs text-muted-foreground">Đang upload file...</p>
          )}
        </div>
      </div>
    </div>
  );
}
