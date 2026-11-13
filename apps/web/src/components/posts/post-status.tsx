// Nhãn + màu trạng thái bài đăng / kênh đích, định dạng giờ Việt Nam.
import type { PostStatus, PostTargetStatus } from '@prisma/client';

import { cn } from '@/lib/utils';

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  DRAFT: 'Nháp',
  SCHEDULED: 'Chờ đăng',
  PUBLISHING: 'Đang đăng',
  PUBLISHED: 'Đã đăng',
  PARTIAL: 'Đăng một phần',
  FAILED: 'Lỗi',
  CANCELLED: 'Đã huỷ',
};

export const TARGET_STATUS_LABEL: Record<PostTargetStatus, string> = {
  PENDING: 'Chờ đăng',
  PUBLISHING: 'Đang đăng',
  PUBLISHED: 'Đã đăng',
  FAILED: 'Lỗi',
  CANCELLED: 'Đã huỷ',
};

const STYLE: Record<PostStatus | PostTargetStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  PENDING: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  PUBLISHING: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  PUBLISHED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  PARTIAL: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  FAILED: 'bg-red-500/15 text-red-700 dark:text-red-300',
  CANCELLED: 'bg-muted text-muted-foreground line-through',
};

export function StatusPill({
  status,
  kind = 'post',
  className,
}: {
  status: PostStatus | PostTargetStatus;
  kind?: 'post' | 'target';
  className?: string;
}) {
  const label =
    kind === 'post'
      ? POST_STATUS_LABEL[status as PostStatus]
      : TARGET_STATUS_LABEL[status as PostTargetStatus];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        STYLE[status],
        className,
      )}
    >
      {label ?? status}
    </span>
  );
}

const VN_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** "14:30 13/11/2026" theo giờ Việt Nam. */
export function formatVnDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return VN_FORMAT.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** Giá trị cho <input type="datetime-local"> theo giờ trình duyệt. */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
