// WhatsApp Business Service — Cloud API qua Meta Graph.
// accountId = phoneNumberId, accessToken = system user permanent token.
//
// V2 read-only: chỉ expose group stats (manual / unsupported). Post-publishing đã bỏ.
// Tham chiếu .claude/skills/platform-integrations.md §6.
import { Injectable, NotFoundException } from '@nestjs/common';
import { Platform } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { BasePlatformService } from './base-platform.service';

// ────────── Types ──────────

export type GroupStatsResult = {
  channelId: string;
  groupId: string;
  memberCount: number | null;
  /** Source của data: 'api' khi fetch được, 'manual' khi store thủ công, 'unsupported' khi không có. */
  source: 'api' | 'manual' | 'unsupported';
  note?: string;
};

// ────────── Service ──────────

@Injectable()
export class WhatsAppService extends BasePlatformService {
  protected readonly platform = Platform.WHATSAPP;

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ============================================================
  // getGroupStats — UNOFFICIAL / not supported by Cloud API
  // ============================================================
  async getGroupStats(groupId: string): Promise<GroupStatsResult> {
    // WhatsApp Cloud API KHÔNG expose group endpoints — groups là feature của
    // user app, không phải Business API. Track member count thủ công qua
    // Channel.metadata.memberCount (set khi admin update qua webhook hoặc UI).

    // Best-effort: tìm Channel theo groupId trong metadata
    const channel = await this.prisma.channel.findFirst({
      where: {
        platform: Platform.WHATSAPP,
        deletedAt: null,
        OR: [{ accountId: groupId }, { metadata: { path: ['groupId'], equals: groupId } }],
      },
      select: { id: true, metadata: true },
    });
    if (!channel) {
      throw new NotFoundException(
        `Không tìm thấy WhatsApp channel cho group ${groupId}`,
      );
    }
    const meta = (channel.metadata as Record<string, unknown>) ?? {};
    const manualCount = meta.memberCount;

    return {
      channelId: channel.id,
      groupId,
      memberCount: typeof manualCount === 'number' ? manualCount : null,
      source: typeof manualCount === 'number' ? 'manual' : 'unsupported',
      note:
        'WhatsApp Cloud API không expose group endpoints. Track member count ' +
        'thủ công qua Channel.metadata.memberCount (admin update). Phase 1 cân nhắc ' +
        'WhatsApp Business unofficial API hoặc webhook tracking.',
    };
  }
}
