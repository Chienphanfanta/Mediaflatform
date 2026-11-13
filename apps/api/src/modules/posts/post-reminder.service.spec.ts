// Integration test — cần Postgres thật (DATABASE_URL) đã `prisma db push`.
// Không có DATABASE_URL → bỏ qua. Telegram/Zalo/Redis được giả lập để bắt tin nhắn.
import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../lib/redis.service';
import type { TelegramClient, TelegramStartCommand } from './messengers/telegram.client';
import type { ZaloClient } from './messengers/zalo.client';
import { PostReminderService } from './post-reminder.service';

const hasDb = !!process.env.DATABASE_URL;
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';
const d = hasDb ? describe : describe.skip;

d('PostReminderService (DB)', () => {
  const prisma = new PrismaClient();
  const sentTelegram: Array<{ chatId: string; text: string }> = [];
  const sentZalo: Array<{ userId: string; text: string }> = [];
  let startCommands: TelegramStartCommand[] = [];

  const telegram = {
    enabled: true,
    sendMessage: async (chatId: string, text: string) => {
      sentTelegram.push({ chatId, text });
      return true;
    },
    pollStartCommands: async () => {
      const c = startCommands;
      startCommands = [];
      return c;
    },
  } as unknown as TelegramClient;
  const zalo = {
    enabled: true,
    sendText: async (userId: string, text: string) => {
      sentZalo.push({ userId, text });
      return true;
    },
  } as unknown as ZaloClient;
  const redis = {
    checkRateLimit: async () => ({ allowed: true, ttl: 0 }),
  } as unknown as RedisService;

  const service = new PostReminderService(
    prisma as unknown as PrismaService,
    redis,
    telegram,
    zalo,
  );

  const tag = `rem-test-${Date.now()}`;
  let tenantId = '';
  let ownerId = '';
  let creatorId = '';
  let channelId = '';

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: tag, slug: tag } });
    tenantId = tenant.id;
    const owner = await prisma.user.create({
      data: {
        tenantId,
        email: `owner-${tag}@x.vn`,
        password: 'x',
        name: 'Chủ kênh <A&B>',
        telegramLinkCode: `link${Date.now()}`,
        zaloUserId: 'zalo-owner-1',
      },
    });
    ownerId = owner.id;
    const creator = await prisma.user.create({
      data: { tenantId, email: `creator-${tag}@x.vn`, password: 'x', name: 'Người soạn', telegramChatId: 'chat-creator' },
    });
    creatorId = creator.id;
    const channel = await prisma.channel.create({
      data: {
        tenantId,
        name: 'Kênh <Test>',
        platform: 'TIKTOK',
        accountId: tag,
        ownerships: { create: { employeeId: ownerId, role: 'PRIMARY' } },
      },
    });
    channelId = channel.id;
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('liên kết Telegram qua /start <mã>', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    startCommands = [
      { chatId: 'chat-owner', code: owner.telegramLinkCode!, fromName: 'A' },
      { chatId: 'chat-x', code: 'sai-ma-123', fromName: 'X' },
    ];
    await service.linkTelegramAccounts();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(after.telegramChatId).toBe('chat-owner');
    expect(after.telegramLinkCode).toBeNull();
    expect(sentTelegram.find((m) => m.chatId === 'chat-owner')?.text).toContain('Đã liên kết');
    expect(sentTelegram.find((m) => m.chatId === 'chat-x')?.text).toContain('không đúng');
  });

  it('nhắc chủ kênh khi đến giờ, chỉ 1 lần, bỏ qua bài nháp/chưa đến giờ', async () => {
    sentTelegram.length = 0;
    sentZalo.length = 0;
    const mk = (caption: string, scheduledAt: Date, status: 'SCHEDULED' | 'DRAFT') =>
      prisma.post.create({
        data: {
          tenantId,
          createdById: creatorId,
          caption,
          scheduledAt,
          status,
          targets: { create: { tenantId, channelId } },
        },
      });
    await mk('Bài đến giờ', new Date(Date.now() - 60_000), 'SCHEDULED');
    await mk('Bài ngày mai', new Date(Date.now() + 86_400_000), 'SCHEDULED');
    await mk('Bài nháp', new Date(Date.now() - 60_000), 'DRAFT');

    await service.remindDuePosts();
    const tg = sentTelegram.filter((m) => m.chatId === 'chat-owner');
    expect(tg).toHaveLength(1);
    expect(tg[0].text).toContain('Đến giờ đăng 1 bài');
    expect(tg[0].text).toContain('Bài đến giờ');
    expect(tg[0].text).not.toContain('Bài ngày mai');
    expect(tg[0].text).toContain('OFFLINE'); // chủ kênh chưa có trình duyệt
    expect(tg[0].text).toContain('Kênh &lt;Test&gt;'); // escape HTML cho Telegram
    expect(sentZalo).toHaveLength(1);
    expect(sentZalo[0].text).not.toMatch(/<\/?b>/); // Zalo nhận text thuần
    expect(sentZalo[0].text).toContain('Kênh <Test>');

    await service.remindDuePosts(); // lần 2 không nhắc lại
    expect(sentTelegram.filter((m) => m.chatId === 'chat-owner')).toHaveLength(1);
  });

  it('báo lỗi cho người tạo bài khi target FAILED, chỉ 1 lần', async () => {
    sentTelegram.length = 0;
    const post = await prisma.post.create({
      data: {
        tenantId,
        createdById: creatorId,
        caption: 'Bài lỗi',
        status: 'FAILED',
        targets: { create: { tenantId, channelId, status: 'FAILED', errorMessage: 'Không tìm thấy nút Đăng' } },
      },
    });
    await service.notifyFailures();
    const msgs = sentTelegram.filter((m) => m.chatId === 'chat-creator');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain('Đăng lỗi');
    expect(msgs[0].text).toContain('Không tìm thấy nút Đăng');
    expect(msgs[0].text).toContain(`https://app.test/posts/${post.id}`);

    await service.notifyFailures();
    expect(sentTelegram.filter((m) => m.chatId === 'chat-creator')).toHaveLength(1);
  });
});
