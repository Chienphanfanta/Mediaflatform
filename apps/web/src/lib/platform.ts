// Ánh xạ platform → màu, label - dùng chung cho channel registry, dashboard, forms.
// V2: bỏ POST_STATUSES (Post entity không còn). Vẫn giữ X enum entry vì Prisma enum
// chưa drop (sẽ drop ở Sprint 3 schema rewrite).
import type { Platform } from '@prisma/client';

export const PLATFORMS: Platform[] = [
  'YOUTUBE',
  'FACEBOOK',
  'INSTAGRAM',
  'X',
  'TELEGRAM',
  'WHATSAPP',
];

export const PLATFORM_LABEL: Record<Platform, string> = {
  YOUTUBE: 'YouTube',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  X: 'X (Twitter)',
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
};

// Background class (với hover variant) cho event pill / legend.
export const PLATFORM_BG: Record<Platform, string> = {
  YOUTUBE: 'bg-red-600 hover:bg-red-700',
  FACEBOOK: 'bg-blue-600 hover:bg-blue-700',
  INSTAGRAM: 'bg-pink-500 hover:bg-pink-600',
  X: 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300',
  TELEGRAM: 'bg-violet-500 hover:bg-violet-600',
  WHATSAPP: 'bg-emerald-500 hover:bg-emerald-600',
};

// Background tĩnh (không hover) cho dot legend, color block...
export const PLATFORM_DOT: Record<Platform, string> = {
  YOUTUBE: 'bg-red-600',
  FACEBOOK: 'bg-blue-600',
  INSTAGRAM: 'bg-pink-500',
  X: 'bg-slate-900 dark:bg-slate-200',
  TELEGRAM: 'bg-violet-500',
  WHATSAPP: 'bg-emerald-500',
};

// V1 POST_STATUSES + POST_STATUS_LABEL + POST_STATUS_STYLE removed — không còn Post entity.
