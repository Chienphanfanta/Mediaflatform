// POST /api/v1/media — xin presigned URL để upload ảnh/video lên MinIO.
//   Body: { fileName, mimeType, sizeBytes }
//   → { mediaId, uploadUrl, method: 'PUT', headers }
// Sau khi trình duyệt PUT xong → gọi POST /api/v1/media/:id/complete để xác nhận.
import crypto from 'node:crypto';

import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { VIDEO_MIME, mediaUploadRequestSchema } from '@/lib/schemas/posts';
import { buildObjectKey, presignUpload } from '@/lib/storage/s3';
import { withAuth } from '@/lib/with-auth';

const MB = 1024 * 1024;

export const POST = withAuth(
  async ({ req, user }) => {
    if (!meetsRole(user, 'STAFF')) {
      return fail('FORBIDDEN', 'Bạn không có quyền upload media', { status: 403 });
    }
    const parsed = mediaUploadRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Thông tin file không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { fileName, mimeType, sizeBytes } = parsed.data;
    const isVideo = (VIDEO_MIME as readonly string[]).includes(mimeType);
    const maxMb = Number(
      isVideo ? (process.env.MEDIA_MAX_VIDEO_MB ?? 1024) : (process.env.MEDIA_MAX_IMAGE_MB ?? 20),
    );
    if (sizeBytes > maxMb * MB) {
      return fail('FILE_TOO_LARGE', `File vượt quá ${maxMb} MB`, { status: 413 });
    }

    const id = crypto.randomUUID();
    const objectKey = buildObjectKey(user.tenantId, id, fileName);
    const uploadUrl = await presignUpload(objectKey, mimeType);

    await prisma.mediaAsset.create({
      data: {
        id,
        tenantId: user.tenantId,
        uploadedById: user.id,
        objectKey,
        fileName,
        mimeType,
        sizeBytes,
        type: isVideo ? 'VIDEO' : 'IMAGE',
      },
    });

    return ok(
      { mediaId: id, uploadUrl, method: 'PUT', headers: { 'Content-Type': mimeType } },
      { status: 201 },
    );
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
