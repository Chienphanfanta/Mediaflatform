// GET /api/v1/ext/me — heartbeat + thông tin trình duyệt/nhân viên + kênh phụ trách.
// Extension gọi mỗi ~1 phút. Header tuỳ chọn: X-Extension-Version.
import { ok } from '@/lib/api-response';
import { withDevice } from '@/lib/posts/device-auth';
import { prisma } from '@/lib/prisma';

export const GET = withDevice(async ({ req, device }) => {
  const version = req.headers.get('x-extension-version')?.slice(0, 20);
  await prisma.browserDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), ...(version ? { extensionVersion: version } : {}) },
  });

  const [user, channels, pending] = await Promise.all([
    prisma.user.findUnique({
      where: { id: device.userId },
      select: { id: true, name: true, email: true, avatar: true },
    }),
    prisma.channel.findMany({
      where: { deletedAt: null, ownerships: { some: { employeeId: device.userId } } },
      select: {
        id: true,
        name: true,
        platform: true,
        accountId: true,
        externalUrl: true,
        metadata: true,
      },
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    }),
    prisma.postTarget.count({
      where: {
        status: 'PENDING',
        post: { deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        channel: { ownerships: { some: { employeeId: device.userId } } },
      },
    }),
  ]);

  return ok({
    device: { id: device.id, name: device.name, browser: device.browser },
    user,
    channels,
    pendingCount: pending,
    serverTime: new Date().toISOString(),
  });
});
