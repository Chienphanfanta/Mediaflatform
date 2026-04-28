// Styling chung cho alerts (severity badge, type label) — share giữa bell + page.
import type { AlertSeverity, AlertType } from '@prisma/client';

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
  CRITICAL: 'Nghiêm trọng',
};

export const SEVERITY_COLOR: Record<
  AlertSeverity,
  { dot: string; badge: string; bar: string }
> = {
  LOW: {
    dot: 'bg-slate-400',
    badge: 'bg-muted text-muted-foreground border-muted',
    bar: 'bg-slate-400',
  },
  MEDIUM: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    bar: 'bg-amber-500',
  },
  HIGH: {
    dot: 'bg-orange-500',
    badge: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
    bar: 'bg-orange-500',
  },
  CRITICAL: {
    dot: 'bg-destructive',
    badge: 'bg-destructive/10 text-destructive border-destructive/30',
    bar: 'bg-destructive',
  },
};

export const TYPE_LABEL: Record<AlertType, string> = {
  TOKEN_EXPIRING: 'Token sắp hết hạn',
  TOKEN_EXPIRED: 'Token đã hết hạn',
  POLICY_VIOLATION: 'Vi phạm chính sách',
  COPYRIGHT_STRIKE: 'Copyright strike',
  VIEW_DROP: 'Views giảm',
  MONETIZATION_LOST: 'Mất monetization',
  MONETIZATION_AT_RISK: 'Nguy cơ mất monetization',
  API_ERROR: 'Lỗi API',
  RATE_LIMIT: 'Rate limit',
  CHANNEL_INACTIVE: 'Kênh không hoạt động',
  SCHEDULED_POST_FAILED: 'Bài hẹn giờ thất bại',
  DEADLINE_APPROACHING: 'Sắp đến deadline',
  OTHER: 'Khác',
};
