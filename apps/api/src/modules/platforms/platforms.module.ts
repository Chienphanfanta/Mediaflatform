// Platforms module — read-only integrations cho 3 nền tảng: YouTube, Facebook, TikTok.
import { Module } from '@nestjs/common';

import { MetaApiClient } from './meta-api-client';
import { MetaService } from './meta.service';
import { TikTokService } from './tiktok.service';
import { YouTubeApiClient } from './youtube-api-client';
import { YouTubeService } from './youtube.service';

@Module({
  providers: [YouTubeApiClient, YouTubeService, MetaApiClient, MetaService, TikTokService],
  exports: [YouTubeService, MetaService, TikTokService],
})
export class PlatformsModule {}
