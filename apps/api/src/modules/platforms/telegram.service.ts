// Telegram Bot Service — không OAuth, dùng bot token trực tiếp.
// Bot token format: `{botId}:{secret}` — encrypted ở Channel.accessToken.
// chatId target lưu ở Channel.metadata.chatId.
//
// V2 read-only: chỉ sync metrics (member count snapshot). Post-publishing đã bỏ.
// Tham chiếu .claude/skills/platform-integrations.md §5.
import { BadRequestException, Injectable } from '@nestjs/common';
import { Platform, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  BasePlatformService,
  type LoadedChannel,
} from './base-platform.service';

// ────────── Telegram errors ──────────

export class TelegramApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: number,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

// ────────── Types ──────────

export type TelegramSyncResult = {
  channelId: string;
  memberCount: number;
  chatTitle: string | null;
};

// ────────── Service ──────────

@Injectable()
export class TelegramService extends BasePlatformService {
  protected readonly platform = Platform.TELEGRAM;

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ============================================================
  // syncChannelStats — getChat + member count
  // ============================================================
  async syncChannelStats(channelId: string): Promise<TelegramSyncResult> {
    const channel = await this.loadChannel(channelId);
    const chatId = this.getChatId(channel);
    const botToken = this.getDecryptedAccessToken(channel);

    // getChat trả title, type, etc.
    const chat = await this.retry(() =>
      this.tgRequest<TgChat>(botToken, 'getChat', { chat_id: chatId }),
    );
    // getChatMemberCount (mới) — alias getChatMembersCount (cũ) deprecated
    const count = await this.retry(() =>
      this.tgRequest<number>(botToken, 'getChatMemberCount', { chat_id: chatId }),
    );

    const meta = (channel.metadata as Record<string, unknown>) ?? {};
    await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        metadata: {
          ...meta,
          chatId,
          chatType: chat.type,
          title: chat.title ?? meta.title ?? null,
          memberCount: count,
          inviteLink: chat.invite_link ?? meta.inviteLink ?? null,
          lastSyncedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    // Upsert Analytics — Telegram chỉ có member count snapshot
    const today = startOfUTCDay(new Date());
    const yesterday = subDays(today, 1);
    const prev = await this.prisma.analytics.findUnique({
      where: { channelId_date: { channelId, date: yesterday } },
      select: { subscribers: true },
    });
    const delta = prev ? count - prev.subscribers : 0;

    await this.prisma.analytics.upsert({
      where: { channelId_date: { channelId, date: today } },
      create: {
        channelId,
        date: today,
        platform: Platform.TELEGRAM,
        views: 0, // Telegram bot API không expose post views (chỉ qua channel admin)
        watchTimeHours: 0,
        subscribers: count,
        subscriberDelta: delta,
        revenue: 0,
        engagementRate: 0,
        impressions: 0,
        clicks: 0,
        fetchedAt: new Date(),
      },
      update: {
        subscribers: count,
        subscriberDelta: delta,
        fetchedAt: new Date(),
      },
    });

    return {
      channelId,
      memberCount: count,
      chatTitle: chat.title ?? null,
    };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private getChatId(channel: LoadedChannel): number | string {
    const meta = (channel.metadata as Record<string, unknown>) ?? {};
    const chatId = meta.chatId;
    if (chatId === null || chatId === undefined) {
      throw new BadRequestException(
        `Channel ${channel.id} chưa có chatId. Add bot vào channel/group, gửi 1 tin → ` +
          `cập nhật metadata.chatId qua PATCH /api/v1/channels/:id`,
      );
    }
    if (typeof chatId !== 'number' && typeof chatId !== 'string') {
      throw new BadRequestException(
        `metadata.chatId phải là number/string, đang là ${typeof chatId}`,
      );
    }
    return chatId;
  }

  private async tgRequest<T>(
    botToken: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as TgResponse<T>;

    if (!data.ok) {
      const code = data.error_code ?? res.status;
      const desc = data.description ?? 'Unknown Telegram error';
      const retryAfter = data.parameters?.retry_after;
      throw new TelegramApiError(res.status, code, desc, retryAfter);
    }
    return data.result as T;
  }
}

// ────────── Local helpers ──────────

function startOfUTCDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86_400_000);
}

// ────────── Telegram API response shapes ──────────

type TgResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};

type TgChat = {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  invite_link?: string;
  description?: string;
};
