// Zod schemas cho endpoints /api/v1/analytics/*
import { z } from 'zod';

export const PERIOD_KEYS = ['7d', '30d', '90d'] as const;
export const TOP_POSTS_PERIOD = ['7d', '30d'] as const;
export const METRIC_KEYS = [
  'views',
  'watchTime',
  'subscribers',
  'revenue',
  'engagement',
  'impressions',
  'clicks',
] as const;
export const SORT_KEYS = ['views', 'engagement', 'revenue'] as const;
export const EXPORT_FORMATS = ['json', 'csv'] as const;

export const overviewQuerySchema = z.object({
  period: z.enum(PERIOD_KEYS).default('30d'),
  groupId: z.string().min(1).optional(),
});
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

// metrics là chuỗi comma-separated — server tự split & validate.
export const channelMetricsQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    metrics: z.string().optional(),
  })
  .refine((d) => d.to >= d.from, { message: 'to phải >= from', path: ['to'] });
export type ChannelMetricsQuery = z.infer<typeof channelMetricsQuerySchema>;

export const topPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  sortBy: z.enum(SORT_KEYS).default('views'),
  period: z.enum(TOP_POSTS_PERIOD).default('30d'),
});
export type TopPostsQuery = z.infer<typeof topPostsQuerySchema>;

// Export schema:
// - channelIds optional → server fallback "all accessible to user"
// - from/to optional → derive từ preset (default 30d) nếu không truyền
// - preset shortcut: 7d/30d/90d
export const exportQuerySchema = z
  .object({
    channelIds: z.array(z.string().min(1)).max(50).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    preset: z.enum(PERIOD_KEYS).optional(),
    format: z.enum(EXPORT_FORMATS).default('json'),
  })
  .refine((d) => !d.from || !d.to || d.to >= d.from, {
    message: 'to phải >= from',
    path: ['to'],
  });
export type ExportQuery = z.infer<typeof exportQuerySchema>;

// Summary endpoint — hỗ trợ preset period HOẶC custom range (from+to override period).
export const summaryQuerySchema = z
  .object({
    period: z.enum(PERIOD_KEYS).default('30d'),
    groupId: z.string().min(1).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((d) => !d.from || !d.to || d.to >= d.from, {
    message: 'to phải >= from',
    path: ['to'],
  })
  .refine((d) => (d.from && d.to) || (!d.from && !d.to), {
    message: 'Cần cả from và to, hoặc bỏ trống cả hai để dùng period',
    path: ['from'],
  });
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

// Map metric key FE → dataset label trong ChartData từ analytics-service.
export const METRIC_TO_LABEL: Record<(typeof METRIC_KEYS)[number], string> = {
  views: 'Views',
  watchTime: 'Watch Time (h)',
  subscribers: 'Subscribers',
  revenue: 'Revenue ($)',
  engagement: 'Engagement %',
  impressions: 'Impressions',
  clicks: 'Clicks',
};

export function parseMetricsFilter(raw: string | undefined): string[] {
  if (!raw) return []; // empty = keep all
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
