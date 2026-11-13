// Ánh xạ platform → màu, label - dùng chung cho channel registry, dashboard, forms.
// V2: chỉ hỗ trợ 3 nền tảng — YouTube, Facebook, TikTok.
import type { Platform } from '@prisma/client';

export const PLATFORMS: Platform[] = ['YOUTUBE', 'FACEBOOK', 'TIKTOK'];

export const PLATFORM_LABEL: Record<Platform, string> = {
  YOUTUBE: 'YouTube',
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
};

// Màu hex cho chart (Recharts) — 1 nguồn duy nhất.
export const PLATFORM_HEX: Record<Platform, string> = {
  YOUTUBE: '#FF0000',
  FACEBOOK: '#1877F2',
  TIKTOK: '#0F172A',
};

// Background class (với hover variant) cho event pill / legend.
export const PLATFORM_BG: Record<Platform, string> = {
  YOUTUBE: 'bg-red-600 hover:bg-red-700',
  FACEBOOK: 'bg-blue-600 hover:bg-blue-700',
  TIKTOK:
    'bg-slate-900 hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300',
};

// Background tĩnh (không hover) cho dot legend, color block...
export const PLATFORM_DOT: Record<Platform, string> = {
  YOUTUBE: 'bg-red-600',
  FACEBOOK: 'bg-blue-600',
  TIKTOK: 'bg-slate-900 dark:bg-slate-200',
};
