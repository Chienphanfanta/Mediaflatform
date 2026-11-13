// GET /api/v1/ext/queue — các target ĐẾN GIỜ đăng mà trình duyệt này phụ trách.
//
// Chỉ trả target của kênh mà nhân viên sở hữu (ChannelOwnership) — vì chỉ trình duyệt
// của họ mới đăng nhập sẵn tài khoản kênh. Nhiều máy cùng thấy 1 target thì máy nào
// claim trước (POST /ext/targets/:id/claim) sẽ đăng.
//
// Đồng thời "gỡ kẹt": target PUBLISHING quá STALE_CLAIM_MS (trình duyệt tắt giữa chừng)
// → trả về PENDING, hoặc FAILED nếu đã thử MAX_ATTEMPTS lần.
import { ok } from '@/lib/api-response';
import { refreshPostStatus } from '@/lib/posts/access';
import { MAX_ATTEMPTS, STALE_CLAIM_MS } from '@/lib/posts/constants';
import { withDevice } from '@/lib/posts/device-auth';
import { prisma } from '@/lib/prisma';
import { presignDownload } from '@/lib/storage/s3';

const QUEUE_LIMIT = 10;

export const GET = withDevice(async ({ device }) => {
  await releaseStaleClaims(device.userId);

  const now = new Date();
  const targets = await prisma.postTarget.findMany({
    where: {
      status: 'PENDING',
      channel: {
        deletedAt: null,
        ownerships: { some: { employeeId: device.userId } },
      },
      post: {
        deletedAt: null,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
      },
    },
    orderBy: [{ post: { scheduledAt: { sort: 'asc', nulls: 'first' } } }, { createdAt: 'asc' }],
    take: QUEUE_LIMIT,
    select: {
      id: true,
      options: true,
      attempts: true,
      channel: {
        select: {
          id: true,
          name: true,
          platform: true,
          accountId: true,
          externalUrl: true,
          metadata: true,
        },
      },
      post: {
        select: {
          id: true,
          title: true,
          caption: true,
          hashtags: true,
          scheduledAt: true,
          media: {
            orderBy: { order: 'asc' },
            select: {
              media: {
                select: {
                  id: true,
                  fileName: true,
                  mimeType: true,
                  sizeBytes: true,
                  type: true,
                  objectKey: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const items = await Promise.all(
    targets.map(async (t) => ({
      targetId: t.id,
      attempts: t.attempts,
      options: t.options,
      platform: t.channel.platform,
      channel: t.channel,
      post: {
        id: t.post.id,
        title: t.post.title,
        caption: t.post.caption,
        hashtags: t.post.hashtags,
        scheduledAt: t.post.scheduledAt,
      },
      media: await Promise.all(
        t.post.media.map(async ({ media }) => ({
          id: media.id,
          fileName: media.fileName,
          mimeType: media.mimeType,
          sizeBytes: media.sizeBytes,
          type: media.type,
          url: await presignDownload(media.objectKey, media.fileName),
        })),
      ),
    })),
  );

  return ok({ items, serverTime: now.toISOString() });
});

async function releaseStaleClaims(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const stale = await prisma.postTarget.findMany({
    where: {
      status: 'PUBLISHING',
      claimedAt: { lt: cutoff },
      channel: { ownerships: { some: { employeeId: userId } } },
    },
    select: { id: true, postId: true, attempts: true },
  });
  for (const t of stale) {
    const giveUp = t.attempts >= MAX_ATTEMPTS;
    await prisma.postTarget.updateMany({
      where: { id: t.id, status: 'PUBLISHING' },
      data: giveUp
        ? {
            status: 'FAILED',
            errorMessage: 'Quá thời gian đăng (trình duyệt tắt hoặc mất kết nối)',
          }
        : { status: 'PENDING', deviceId: null, claimedAt: null },
    });
    await refreshPostStatus(t.postId);
  }
}
