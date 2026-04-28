// GET /api/v1/platforms/:platform/verify/:channelId
// Decrypt token → gọi platform.verifyToken. Update Channel.status nếu invalid.
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { decryptToken } from '@/lib/crypto/token-encryption';
import { getAdapter, platformFromSlug } from '@/lib/platform-oauth';

export const GET = withAuth<{ platform: string; channelId: string }>(
  async ({ user, params }) => {
    const platform = platformFromSlug(params.platform);
    if (!platform) {
      return fail('UNKNOWN_PLATFORM', `Platform không hợp lệ: ${params.platform}`, {
        status: 404,
      });
    }

    const channel = await prisma.channel.findFirst({
      where: user.isSuperAdmin
        ? { id: params.channelId, deletedAt: null, platform }
        : {
            id: params.channelId,
            deletedAt: null,
            platform,
            groups: {
              some: { groupId: { in: user.groups.map((g) => g.id) } },
            },
          },
      select: {
        id: true,
        accessToken: true,
        tokenExpiresAt: true,
        status: true,
      },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy channel hoặc không có quyền', {
        status: 404,
      });
    }
    if (!channel.accessToken) {
      return ok({
        valid: false,
        reason: 'Channel chưa kết nối token',
        currentStatus: channel.status,
      });
    }

    // Token đã hết hạn (theo DB) → mark TOKEN_EXPIRED, không cần gọi API
    if (channel.tokenExpiresAt && channel.tokenExpiresAt.getTime() < Date.now()) {
      if (channel.status !== 'TOKEN_EXPIRED') {
        await prisma.channel.update({
          where: { id: channel.id },
          data: { status: 'TOKEN_EXPIRED' },
        });
      }
      return ok({
        valid: false,
        reason: 'Token đã hết hạn (theo `tokenExpiresAt`)',
        currentStatus: 'TOKEN_EXPIRED',
      });
    }

    let plaintext: string;
    try {
      plaintext = decryptToken(channel.accessToken);
    } catch (e) {
      return fail(
        'TOKEN_DECRYPT_FAILED',
        `Không decrypt được token (key sai?): ${(e as Error).message}`,
        { status: 500 },
      );
    }

    const adapter = getAdapter(platform);
    const result = await adapter.verifyToken(plaintext);

    // Update Channel.status theo kết quả verify
    const nextStatus = result.valid ? 'ACTIVE' : 'ERROR';
    if (channel.status !== nextStatus) {
      await prisma.channel.update({
        where: { id: channel.id },
        data: { status: nextStatus },
      });
    }

    return ok({
      valid: result.valid,
      reason: result.reason,
      account: result.account,
      currentStatus: nextStatus,
    });
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);
