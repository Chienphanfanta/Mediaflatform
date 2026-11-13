// Nhắc lịch đăng bài qua Telegram / Zalo — chạy mỗi phút.
//
// 1. Liên kết Telegram: đọc "/start <mã>" từ bot → gán User.telegramChatId
// 2. Đến giờ đăng: target PENDING có scheduledAt <= now, chưa nhắc → nhắn cho
//    người phụ trách kênh (PRIMARY trước, nếu không có thì mọi owner). Extension sẽ tự
//    đăng nếu trình duyệt đang mở; tin nhắn nhắc nhân viên mở Chrome/Cốc Cốc.
// 3. Đăng lỗi: target FAILED chưa báo → nhắn cho người tạo bài.
//
// Cross-tenant job → dùng PrismaService thường (api không gắn tenant extension).
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../lib/redis.service';
import { TelegramClient, tgEscape } from './messengers/telegram.client';
import { ZaloClient } from './messengers/zalo.client';

const LOCK_KEY = 'posts:reminder:lock';
const BATCH = 100;

const PLATFORM_LABEL: Record<string, string> = {
  YOUTUBE: 'YouTube',
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
};

type Recipient = { id: string; telegramChatId: string | null; zaloUserId: string | null };

@Injectable()
export class PostReminderService {
  private readonly logger = new Logger(PostReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly telegram: TelegramClient,
    private readonly zalo: ZaloClient,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    // Nhiều instance api → chỉ 1 instance chạy mỗi phút
    const lock = await this.redis.checkRateLimit(LOCK_KEY, 50);
    if (!lock.allowed) return;
    try {
      await this.linkTelegramAccounts();
      await this.remindDuePosts();
      await this.notifyFailures();
    } catch (e) {
      this.logger.error(`Reminder run lỗi: ${(e as Error).message}`);
    }
  }

  // ─── 1. Liên kết Telegram ─────────────────────────────────────────────────

  async linkTelegramAccounts(): Promise<void> {
    const cmds = await this.telegram.pollStartCommands();
    for (const c of cmds) {
      const user = await this.prisma.user.findUnique({
        where: { telegramLinkCode: c.code },
        select: { id: true, name: true },
      });
      if (!user) {
        await this.telegram.sendMessage(
          c.chatId,
          'Mã liên kết không đúng hoặc đã dùng. Vào hệ thống → Đăng bài → Trình duyệt để lấy mã mới.',
        );
        continue;
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: c.chatId, telegramLinkCode: null },
      });
      await this.telegram.sendMessage(
        c.chatId,
        `✅ Đã liên kết với tài khoản <b>${tgEscape(user.name)}</b>. Bạn sẽ nhận nhắc lịch đăng bài tại đây.`,
      );
    }
  }

  // ─── 2. Nhắc đến giờ đăng ─────────────────────────────────────────────────

  async remindDuePosts(): Promise<void> {
    const now = new Date();
    const targets = await this.prisma.postTarget.findMany({
      where: {
        status: 'PENDING',
        remindedAt: null,
        post: {
          deletedAt: null,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          scheduledAt: { lte: now },
        },
      },
      take: BATCH,
      select: {
        id: true,
        post: { select: { id: true, title: true, caption: true, scheduledAt: true } },
        channel: {
          select: {
            name: true,
            platform: true,
            ownerships: {
              select: {
                role: true,
                employee: {
                  select: {
                    id: true,
                    status: true,
                    telegramChatId: true,
                    zaloUserId: true,
                    browsers: {
                      where: { revokedAt: null },
                      select: { lastSeenAt: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (targets.length === 0) return;

    // Gom theo người nhận → 1 tin cho nhiều bài
    const byUser = new Map<string, { user: Recipient; lines: string[]; browserOnline: boolean }>();
    for (const t of targets) {
      const owners = t.channel.ownerships.filter((o) => o.employee.status === 'ACTIVE');
      const primary = owners.filter((o) => o.role === 'PRIMARY');
      const recipients = (primary.length ? primary : owners).map((o) => o.employee);
      const snippet = (t.post.title || t.post.caption).replace(/\s+/g, ' ').slice(0, 80);
      const line = `• <b>${tgEscape(t.channel.name)}</b> (${PLATFORM_LABEL[t.channel.platform] ?? t.channel.platform}): ${tgEscape(snippet)}`;
      for (const r of recipients) {
        const online = r.browsers.some(
          (b) => !!b.lastSeenAt && Date.now() - b.lastSeenAt.getTime() < 3 * 60_000,
        );
        const entry = byUser.get(r.id) ?? { user: r, lines: [], browserOnline: online };
        entry.lines.push(line);
        entry.browserOnline &&= online;
        byUser.set(r.id, entry);
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? '';
    for (const { user, lines, browserOnline } of byUser.values()) {
      const text = [
        `⏰ <b>Đến giờ đăng ${lines.length} bài</b>`,
        ...lines,
        '',
        browserOnline
          ? 'Trình duyệt của bạn đang online — extension sẽ tự đăng.'
          : '⚠️ Trình duyệt của bạn đang OFFLINE. Hãy mở Chrome/Cốc Cốc có cài extension để tự đăng.',
        appUrl ? `${appUrl}/posts` : '',
      ]
        .filter((l, i, arr) => l !== '' || i < arr.length - 1)
        .join('\n');
      await this.notify(user, text);
    }

    await this.prisma.postTarget.updateMany({
      where: { id: { in: targets.map((t) => t.id) }, remindedAt: null },
      data: { remindedAt: now },
    });
  }

  // ─── 3. Báo lỗi đăng ──────────────────────────────────────────────────────

  async notifyFailures(): Promise<void> {
    const targets = await this.prisma.postTarget.findMany({
      where: { status: 'FAILED', failureNotifiedAt: null, post: { deletedAt: null } },
      take: BATCH,
      select: {
        id: true,
        errorMessage: true,
        channel: { select: { name: true, platform: true } },
        post: {
          select: {
            id: true,
            title: true,
            caption: true,
            createdBy: { select: { id: true, telegramChatId: true, zaloUserId: true } },
          },
        },
      },
    });
    if (targets.length === 0) return;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? '';
    for (const t of targets) {
      const snippet = (t.post.title || t.post.caption).replace(/\s+/g, ' ').slice(0, 80);
      const text = [
        `❌ <b>Đăng lỗi</b> — ${tgEscape(t.channel.name)} (${PLATFORM_LABEL[t.channel.platform] ?? t.channel.platform})`,
        tgEscape(snippet),
        `Lỗi: ${tgEscape((t.errorMessage ?? 'Không rõ').slice(0, 300))}`,
        appUrl ? `${appUrl}/posts/${t.post.id}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      await this.notify(t.post.createdBy, text);
    }
    await this.prisma.postTarget.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { failureNotifiedAt: new Date() },
    });
  }

  // ─── Gửi ──────────────────────────────────────────────────────────────────

  private async notify(user: Recipient, htmlText: string): Promise<void> {
    const sent: string[] = [];
    if (user.telegramChatId && (await this.telegram.sendMessage(user.telegramChatId, htmlText))) {
      sent.push('telegram');
    }
    if (user.zaloUserId) {
      // Zalo không hỗ trợ HTML → bỏ thẻ
      const plain = htmlText
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      if (await this.zalo.sendText(user.zaloUserId, plain)) sent.push('zalo');
    }
    if (sent.length === 0) {
      this.logger.debug(`User ${user.id} chưa liên kết Telegram/Zalo — bỏ qua nhắc`);
    }
  }
}
