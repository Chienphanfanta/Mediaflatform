// POST /api/v1/platforms/:platform/disconnect/:channelId
// Revoke token tại provider (best effort) → soft delete Channel.
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';
import { decryptToken } from '@/lib/crypto/token-encryption';
import { getAdapter, platformFromSlug } from '@/lib/platform-oauth';

export const POST = withAuth<{ platform: string; channelId: string }>(
  async ({ user, params }) => {
    const platform = platformFromSlug(params.platform);
    if (!platform) {
      return fail('UNKNOWN_PLATFORM', `Platform không hợp lệ: ${params.platform}`, {
        status: 404,
      });
    }

    const channel = await prisma.channel.findFirst({
      where: { id: params.channelId, deletedAt: null, platform },
      include: { groups: { select: { groupId: true } } },
    });
    if (!channel) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy channel', { status: 404 });
    }

    // Permission check: cần channel:DELETE trong any group channel thuộc về
    const groupIds = channel.groups.map((g) => g.groupId);
    const canDisconnect =
      user.isSuperAdmin ||
      groupIds.some(
        (gid) =>
          hasPermission(user, 'channel', 'DELETE', { groupId: gid }) ||
          hasPermission(user, 'channel', 'FULL', { groupId: gid }),
      );
    if (!canDisconnect) {
      return fail('FORBIDDEN', 'Không có quyền disconnect channel này', {
        status: 403,
      });
    }

    // Best-effort revoke. Decrypt → call adapter. Không throw nếu fail.
    if (channel.accessToken) {
      try {
        const plaintext = decryptToken(channel.accessToken);
        const adapter = getAdapter(platform);
        await adapter.revokeToken(plaintext);
      } catch (e) {
        // Log + tiếp tục soft delete — DB cleanup quan trọng hơn API revoke
        console.warn(
          `[disconnect] revoke failed for channel ${channel.id}:`,
          (e as Error).message,
        );
      }
    }

    // Clear tokens + status DISCONNECTED. KHÔNG soft delete — record giữ để
    // user có thể reconnect (OAuth callback upsert sẽ resurrect nếu match
    // platform + accountId). DELETE /api/v1/channels/:id mới thực sự soft delete.
    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        status: 'INACTIVE',
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
      },
    });

    return ok({ disconnectedAt: new Date().toISOString(), channelId: channel.id });
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
