// Platforms module — gom integrations cho 6 nền tảng truyền thông.
// Phase 6: YouTube + Meta (FB + IG) + X (Twitter) + Telegram + WhatsApp.
import { Module } from '@nestjs/common';

import { MetaApiClient } from './meta-api-client';
import { MetaService } from './meta.service';
import { TelegramService } from './telegram.service';
import { TwitterService } from './twitter.service';
import { WhatsAppService } from './whatsapp.service';
import { YouTubeApiClient } from './youtube-api-client';
import { YouTubeService } from './youtube.service';

@Module({
  providers: [
    YouTubeApiClient,
    YouTubeService,
    MetaApiClient,
    MetaService,
    TwitterService,
    TelegramService,
    WhatsAppService,
  ],
  exports: [
    YouTubeService,
    MetaService,
    TwitterService,
    TelegramService,
    WhatsAppService,
  ],
})
export class PlatformsModule {}
