// POST /api/v1/media/:id/complete — xác nhận file đã upload lên MinIO.
// Kiểm tra object thật sự tồn tại + size khớp khai báo (chênh ≤ 1%).
import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { headObject, presignDownload } from '@/lib/storage/s3';
import { withAuth } from '@/lib/with-auth';

export const POST = withAuth<{ id: string }>(async ({ params, user }) => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: params.id } });
  if (!asset || asset.uploadedById !== user.id) {
    return fail('NOT_FOUND', 'Không tìm thấy file', { status: 404 });
  }

  const size = await headObject(asset.objectKey);
  if (size === null) {
    return fail('NOT_UPLOADED', 'File chưa được upload lên kho lưu trữ', { status: 409 });
  }
  if (Math.abs(size - asset.sizeBytes) > Math.max(1024, asset.sizeBytes * 0.01)) {
    return fail('SIZE_MISMATCH', 'Kích thước file không khớp, vui lòng upload lại', {
      status: 409,
    });
  }

  const updated = await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { uploadedAt: asset.uploadedAt ?? new Date(), sizeBytes: size },
  });

  return ok({
    id: updated.id,
    fileName: updated.fileName,
    mimeType: updated.mimeType,
    sizeBytes: updated.sizeBytes,
    type: updated.type,
    previewUrl: await presignDownload(updated.objectKey, updated.fileName),
  });
});
