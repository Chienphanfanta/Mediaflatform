// Posts module (api) — việc nền cho tính năng đăng bài qua extension:
// nhắc lịch qua Telegram / Zalo OA. (CRUD bài đăng nằm ở apps/web API routes.)
import { Module } from '@nestjs/common';

import { TelegramClient } from './messengers/telegram.client';
import { ZaloClient } from './messengers/zalo.client';
import { PostReminderService } from './post-reminder.service';

@Module({
  providers: [TelegramClient, ZaloClient, PostReminderService],
  exports: [TelegramClient, ZaloClient],
})
export class PostsModule {}
