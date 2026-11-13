// DELETE /api/v1/devices/:id — thu hồi trình duyệt (extension mất quyền ngay request sau).
// Target đang PUBLISHING trên trình duyệt này được trả về PENDING để máy khác đăng.
import { fail, noContent } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';

export const DELETE = withAuth<{ id: string }>(async ({ params, user }) => {
  const device = await prisma.browserDevice.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!device) return fail('NOT_FOUND', 'Không tìm thấy trình duyệt', { status: 404 });
  if (device.userId !== user.id && !meetsRole(user, 'MANAGER')) {
    return fail('FORBIDDEN', 'Bạn không được thu hồi trình duyệt này', { status: 403 });
  }
  if (device.revokedAt) return noContent();

  await prisma.$transaction([
    prisma.browserDevice.update({
      where: { id: device.id },
      data: { revokedAt: new Date() },
    }),
    prisma.postTarget.updateMany({
      where: { deviceId: device.id, status: 'PUBLISHING' },
      data: { status: 'PENDING', deviceId: null, claimedAt: null },
    }),
  ]);
  return noContent();
});
