// Nghiệp vụ bài đăng dùng chung giữa các route.
import type { Platform, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';
import { presignDownload } from '@/lib/storage/s3';

import { findForbiddenChannels, postableChannelWhere } from './access';

export const POST_INCLUDE = {
  createdBy: { select: { id: true, name: true, avatar: true } },
  media: {
    orderBy: { order: 'asc' },
    include: {
      media: {
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, type: true, objectKey: true },
      },
    },
  },
  targets: {
    orderBy: { createdAt: 'asc' },
    include: {
      channel: { select: { id: true, name: true, platform: true, externalUrl: true } },
      device: { select: { id: true, name: true, browser: true } },
    },
  },
} satisfies Prisma.PostInclude;

export type PostWithRelations = Prisma.PostGetPayload<{ include: typeof POST_INCLUDE }>;

/** Bỏ objectKey, thêm previewUrl (presigned) cho media. */
export async function serializePost(post: PostWithRelations, withUrls = false) {
  const media = await Promise.all(
    post.media.map(async ({ media, order }) => {
      const { objectKey, ...rest } = media;
      return {
        ...rest,
        order,
        ...(withUrls ? { previewUrl: await presignDownload(objectKey, media.fileName) } : {}),
      };
    }),
  );
  return { ...post, media };
}

/** Điều kiện xem bài: bài mình tạo, hoặc có target vào kênh mình được đăng. */
export function visiblePostWhere(user: SessionUser): Prisma.PostWhereInput {
  const channelWhere = postableChannelWhere(user);
  return {
    deletedAt: null,
    OR: [
      { createdById: user.id },
      ...(channelWhere ? [{ targets: { some: { channel: channelWhere } } }] : []),
    ],
  };
}

export class PostValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
  ) {
    super(message);
  }
}

/**
 * Kiểm tra kênh + media hợp lệ cho bài đăng. Throw PostValidationError nếu sai.
 * Quy tắc theo nền tảng:
 *   - YouTube: bắt buộc đúng 1 video + có tiêu đề
 *   - TikTok:  bắt buộc có video (1 video) hoặc ảnh (tối đa 35 ảnh — dùng ≤10 theo schema)
 *   - Facebook: cho phép chỉ có chữ
 */
export async function validatePostInput(
  user: SessionUser,
  input: { channelIds: string[]; mediaIds: string[]; title?: string | null },
): Promise<{ platforms: Map<string, Platform> }> {
  const channelIds = Array.from(new Set(input.channelIds));
  const forbidden = await findForbiddenChannels(user, channelIds);
  if (forbidden.length > 0) {
    throw new PostValidationError(
      'CHANNEL_FORBIDDEN',
      'Bạn không có quyền đăng lên một số kênh đã chọn',
      403,
    );
  }

  const channels = await prisma.channel.findMany({
    where: { id: { in: channelIds } },
    select: { id: true, platform: true },
  });
  const platforms = new Map(channels.map((c) => [c.id, c.platform]));

  const mediaIds = Array.from(new Set(input.mediaIds));
  const media = await prisma.mediaAsset.findMany({
    where: { id: { in: mediaIds } },
    select: { id: true, type: true, uploadedAt: true },
  });
  if (media.length !== mediaIds.length || media.some((m) => !m.uploadedAt)) {
    throw new PostValidationError('MEDIA_INVALID', 'Có file chưa upload xong hoặc không tồn tại');
  }
  const videos = media.filter((m) => m.type === 'VIDEO').length;
  const images = media.length - videos;
  if (videos > 1 || (videos === 1 && images > 0)) {
    throw new PostValidationError('MEDIA_MIXED', 'Mỗi bài chỉ được 1 video, hoặc chỉ gồm ảnh');
  }

  const set = new Set(platforms.values());
  if (set.has('YOUTUBE')) {
    if (videos !== 1) {
      throw new PostValidationError('YOUTUBE_NEEDS_VIDEO', 'YouTube cần đúng 1 video');
    }
    if (!input.title?.trim()) {
      throw new PostValidationError('YOUTUBE_NEEDS_TITLE', 'YouTube cần tiêu đề video');
    }
  }
  if (set.has('TIKTOK') && media.length === 0) {
    throw new PostValidationError('TIKTOK_NEEDS_MEDIA', 'TikTok cần video hoặc ảnh');
  }

  return { platforms };
}
