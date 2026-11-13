// Zod schemas cho module đăng bài qua browser extension.
import { z } from 'zod';

const PLATFORM_VALUES = ['YOUTUBE', 'FACEBOOK', 'TIKTOK'] as const;

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

// ─── Media ──────────────────────────────────────────────────────────────────

export const mediaUploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum([...IMAGE_MIME, ...VIDEO_MIME]),
  sizeBytes: z.number().int().positive(),
});

// ─── Post ───────────────────────────────────────────────────────────────────

export const targetOptionsSchema = z
  .object({
    privacy: z.enum(['public', 'private', 'unlisted', 'friends']).optional(),
    madeForKids: z.boolean().optional(), // YouTube bắt buộc chọn
  })
  .strict();

const postBaseSchema = z.object({
  title: z.string().trim().max(100).optional().nullable(),
  caption: z.string().trim().min(1, 'Nội dung không được để trống').max(5000),
  hashtags: z
    .array(z.string().trim().regex(/^#?[\p{L}\p{N}_]+$/u, 'Hashtag không hợp lệ').max(100))
    .max(30)
    .default([]),
  scheduledAt: z.coerce.date().optional().nullable(),
  mediaIds: z.array(z.string().min(1)).max(10).default([]),
  channelIds: z.array(z.string().min(1)).min(1, 'Chọn ít nhất 1 kênh').max(50),
  options: targetOptionsSchema.optional(),
  /** true = lưu nháp (extension chưa thấy); false = đưa vào hàng chờ đăng */
  draft: z.boolean().default(false),
});

export const createPostSchema = postBaseSchema;

export const updatePostSchema = postBaseSchema.partial();

export const listPostsQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED'])
    .optional(),
  platform: z.enum(PLATFORM_VALUES).optional(),
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Extension (device) ──────────────────────────────────────────────────────

export const pairDeviceSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, 'Mã ghép gồm 6 ký tự'),
  name: z.string().trim().min(1).max(80),
  browser: z.enum(['CHROME', 'COCCOC', 'OTHER']),
  os: z.string().max(80).optional(),
  extensionVersion: z.string().max(20).optional(),
});

export const heartbeatSchema = z.object({
  extensionVersion: z.string().max(20).optional(),
});

export const targetResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    externalUrl: z.string().url().max(2000).optional().nullable(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string().min(1).max(2000),
    /** true = lỗi tạm thời (mạng, trang load chậm) → trả về PENDING để thử lại */
    retryable: z.boolean().default(false),
  }),
]);

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type TargetResultInput = z.infer<typeof targetResultSchema>;
