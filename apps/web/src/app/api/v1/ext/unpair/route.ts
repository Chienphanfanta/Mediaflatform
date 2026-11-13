// POST /api/v1/ext/unpair — extension tự thu hồi device token khi người dùng bấm
// "Ngắt kết nối". Target đang đăng dở trên máy này được trả về hàng chờ.
import { noContent } from '@/lib/api-response';
import { withDevice } from '@/lib/posts/device-auth';
import { prisma } from '@/lib/prisma';

export const POST = withDevice(async ({ device }) => {
  await prisma.$transaction([
    prisma.browserDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } }),
    prisma.postTarget.updateMany({
      where: { deviceId: device.id, status: 'PUBLISHING' },
      data: { status: 'PENDING', deviceId: null, claimedAt: null },
    }),
  ]);
  return noContent();
});
