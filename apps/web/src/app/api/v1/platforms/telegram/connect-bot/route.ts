// POST /api/v1/platforms/telegram/connect-bot
// Telegram không OAuth — user dán bot token, server validate via getMe + lưu Channel.
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { hasPermission } from '@/lib/rbac';
import { encryptToken } from '@/lib/crypto/token-encryption';
import { telegramAdapter } from '@/lib/platform-oauth/adapters';

const bodySchema = z.object({
  botToken: z
    .string()
    .trim()
    .regex(/^\d+:[A-Za-z0-9_-]+$/, 'Bot token không đúng format (lấy từ @BotFather)'),
  groupId: z.string().min(1),
  /** Tên hiển thị tuỳ chọn — mặc định = bot username. */
  channelName: z.string().trim().min(1).max(100).optional(),
});

export const POST = withAuth(
  async ({ req, user }) => {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { botToken, groupId, channelName } = parsed.data;

    // Verify user thuộc group + có quyền channel:CREATE
    const isMember = user.isSuperAdmin || user.groups.some((g) => g.id === groupId);
    if (!isMember) {
      return fail('FORBIDDEN', 'Bạn không thuộc group này', { status: 403 });
    }
    const canCreate =
      user.isSuperAdmin ||
      hasPermission(user, 'channel', 'CREATE', { groupId }) ||
      hasPermission(user, 'channel', 'FULL', { groupId });
    if (!canCreate) {
      return fail('FORBIDDEN', 'Không có quyền tạo channel trong group này', {
        status: 403,
      });
    }

    // Validate bot token via Telegram getMe
    let tokenSet;
    try {
      tokenSet = await telegramAdapter.connectViaToken!(botToken, { name: channelName });
    } catch (e) {
      return fail('INVALID_BOT_TOKEN', (e as Error).message, { status: 400 });
    }

    const encryptedAccess = encryptToken(tokenSet.accessToken);

    const channel = await prisma.channel.upsert({
      where: {
        tenantId_platform_accountId: {
          tenantId: user.tenantId,
          platform: 'TELEGRAM',
          accountId: tokenSet.account.externalId,
        },
      },
      create: {
        tenantId: user.tenantId,
        name: tokenSet.account.name,
        platform: 'TELEGRAM',
        accountId: tokenSet.account.externalId,
        accessToken: encryptedAccess,
        refreshToken: null,
        tokenExpiresAt: null, // bot token vĩnh viễn
        status: 'ACTIVE',
        metadata: {
          ...tokenSet.account.metadata,
          tokenScope: tokenSet.scope,
          connectedAt: new Date().toISOString(),
          connectedBy: user.id,
        } as Prisma.InputJsonValue,
        groups: { create: { groupId } },
        ownerships: {
          create: {
            employeeId: user.id,
            role: 'PRIMARY',
            assignedById: user.id,
          },
        },
      },
      update: {
        name: tokenSet.account.name,
        accessToken: encryptedAccess,
        status: 'ACTIVE',
        metadata: {
          ...tokenSet.account.metadata,
          tokenScope: tokenSet.scope,
          reconnectedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
        deletedAt: null,
      },
    });

    await prisma.channelGroup.upsert({
      where: { channelId_groupId: { channelId: channel.id, groupId } },
      create: { channelId: channel.id, groupId },
      update: {},
    });

    return ok(
      {
        channelId: channel.id,
        name: channel.name,
        platform: channel.platform,
        accountId: channel.accountId,
        botUsername: tokenSet.account.metadata.botUsername,
        nextStep:
          'Add bot vào channel/group đích (làm admin) rồi gửi tin nhắn đầu tiên — server sẽ detect chatId.',
      },
      { status: 201 },
    );
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);
