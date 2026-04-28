// YouTube Integration Service — V2 read-only: sync analytics + channel metadata.
//
// V2 refactor: Post entity removed. This service is purely read-only —
// fetches metrics/metadata from YouTube and writes to prisma.analytics / prisma.channel.
// Publishing/uploading/scheduling methods have been deleted.
//
// Flow chuẩn cho mỗi method:
//   1. Load Channel + verify platform=YOUTUBE
//   2. (sync methods) Rate-limit check qua Redis — 1 call/channel/giờ cho stats
//   3. withTokenRefresh wrapper: pre-emptive refresh nếu token sắp expire,
//      hoặc retry 1 lần khi gặp TokenExpiredError
//   4. Call YouTubeApiClient
//   5. Persist vào Prisma (Analytics upsert / Channel metadata)
//
// Token: encrypted AES-256-GCM trong DB. Decrypt → dùng → re-encrypt khi refresh.
// LƯU Ý: KHÔNG log plaintext token — dùng maskToken() nếu cần debug.
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  ChannelStatus,
  Platform,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../lib/redis.service';
import { decryptToken, encryptToken, maskToken } from '../../lib/token-encryption';
import {
  RateLimitedError,
  TokenExpiredError,
  VideoProcessingError,
  YouTubeApiClient,
  YouTubeApiError,
  YT,
} from './youtube-api-client';

// ────────── Types ──────────

export type SyncStatsResult = {
  channelId: string;
  daysFetched: number;
  rowsUpserted: number;
  skippedReason?: 'rate-limited' | 'no-data';
  retryAfterSec?: number;
};

export type SyncVideosResult = {
  channelId: string;
  videosFetched: number;
};

export type MonetizationStatus = {
  monetized: boolean;
  strikes: Array<{ type: string; description: string }>;
  warnings: string[];
  details: {
    subscribers: number;
    videoCount: number;
    privacyStatus: string | null;
    madeForKids: boolean | null;
    isLinked: boolean | null;
    communityGuidelinesGoodStanding: boolean | null;
    copyrightStrikesGoodStanding: boolean | null;
    contentIdClaimsGoodStanding: boolean | null;
  };
};

// ────────── Constants ──────────
const RATE_LIMIT_KEY = (channelId: string) => `yt:sync-stats:${channelId}`;
const RATE_LIMIT_WINDOW_SEC = 60 * 60; // 1 giờ
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh nếu < 5 phút còn lại
const ANALYTICS_DAYS_LOOKBACK = 7; // YT Analytics có lag ~1 ngày — fetch 7 ngày để fill missing

// Channel fields cần cho mọi op
const CHANNEL_SELECT = {
  id: true,
  tenantId: true,
  platform: true,
  accountId: true,
  accessToken: true,
  refreshToken: true,
  tokenExpiresAt: true,
  metadata: true,
  status: true,
} as const;

type ChannelWithToken = Pick<Channel, keyof typeof CHANNEL_SELECT>;

// ────────── Service ──────────

@Injectable()
export class YouTubeService {
  private readonly logger = new Logger(YouTubeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly api: YouTubeApiClient,
  ) {}

  // ============================================================
  // 1. syncChannelStats
  // ============================================================
  async syncChannelStats(channelId: string): Promise<SyncStatsResult> {
    const channel = await this.loadYouTubeChannel(channelId);

    // Rate limit: 1 call/channel/giờ
    const rl = await this.redis.checkRateLimit(
      RATE_LIMIT_KEY(channelId),
      RATE_LIMIT_WINDOW_SEC,
    );
    if (!rl.allowed) {
      this.logger.log(`syncChannelStats: rate-limited cho ${channelId}, TTL ${rl.ttl}s`);
      return {
        channelId,
        daysFetched: 0,
        rowsUpserted: 0,
        skippedReason: 'rate-limited',
        retryAfterSec: rl.ttl,
      };
    }

    const today = startOfUTCDay(new Date());
    const endDate = subDays(today, 1); // YT Analytics delay 1 ngày
    const startDate = subDays(today, ANALYTICS_DAYS_LOOKBACK);

    const reportData = await this.withTokenRefresh(channel, async (token) => {
      const url = new URL(`${YT.ANALYTICS}/reports`);
      url.searchParams.set('ids', `channel==${channel.accountId}`);
      url.searchParams.set('startDate', isoDate(startDate));
      url.searchParams.set('endDate', isoDate(endDate));
      url.searchParams.set(
        'metrics',
        // estimatedRevenue cần scope yt-analytics-monetary.readonly
        // Nếu kênh chưa cấp scope đó → returns 0
        'views,estimatedMinutesWatched,subscribersGained,estimatedRevenue,impressions',
      );
      url.searchParams.set('dimensions', 'day');
      return this.api.request<YouTubeAnalyticsResponse>(url.toString(), {}, token);
    });

    const rows = reportData.rows ?? [];
    if (rows.length === 0) {
      // Clear rate limit để retry sớm hơn (no data thì không tốn quota nhiều)
      await this.redis.del(RATE_LIMIT_KEY(channelId));
      return {
        channelId,
        daysFetched: 0,
        rowsUpserted: 0,
        skippedReason: 'no-data',
      };
    }

    // Fetch current channel statistics → cập nhật subscribers absolute + metadata
    const channelStats = await this.withTokenRefresh(channel, (token) =>
      this.api.request<YouTubeChannelsResponse>(
        `${YT.V3}/channels?part=statistics,snippet&id=${channel.accountId}`,
        {},
        token,
      ),
    );
    const stats = channelStats.items?.[0]?.statistics;
    const currentSubs = stats ? Number(stats.subscriberCount ?? 0) : 0;

    // Upsert mỗi ngày
    let upserted = 0;
    for (const row of rows) {
      const [date, views, watchMin, subsGained, revenue] = row as [
        string,
        number,
        number,
        number,
        number,
      ];
      const dateOnly = new Date(date);
      const watchTimeHours = Number(watchMin ?? 0) / 60;

      await this.prisma.analytics.upsert({
        where: { channelId_date: { channelId, date: dateOnly } },
        create: {
          tenantId: channel.tenantId,
          channelId,
          date: dateOnly,
          platform: Platform.YOUTUBE,
          views: Number(views ?? 0),
          watchTimeHours,
          subscribers: 0, // sẽ update ở dòng cuối nếu là yesterday
          subscriberDelta: Number(subsGained ?? 0),
          revenue: Number(revenue ?? 0),
          engagementRate: 0,
          impressions: 0,
          clicks: 0,
          fetchedAt: new Date(),
        },
        update: {
          views: Number(views ?? 0),
          watchTimeHours,
          subscriberDelta: Number(subsGained ?? 0),
          revenue: Number(revenue ?? 0),
          fetchedAt: new Date(),
        },
      });
      upserted++;
    }

    // Update absolute subscribers cho ngày cuối (yesterday) + Channel.metadata
    if (stats) {
      await this.prisma.analytics
        .update({
          where: { channelId_date: { channelId, date: endDate } },
          data: { subscribers: currentSubs },
        })
        .catch(() => {
          /* row có thể chưa tồn tại nếu rows trả từ YT skip yesterday */
        });

      const meta = (channel.metadata as Record<string, unknown>) ?? {};
      await this.prisma.channel.update({
        where: { id: channelId },
        data: {
          metadata: {
            ...meta,
            subscriberCount: currentSubs,
            viewCount: Number(stats.viewCount ?? 0),
            videoCount: Number(stats.videoCount ?? 0),
            lastSyncedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }

    this.logger.log(`syncChannelStats: ${channelId} upserted ${upserted} rows`);
    return { channelId, daysFetched: rows.length, rowsUpserted: upserted };
  }

  // ============================================================
  // 2. syncChannelVideos — fetch danh sách videos để cache uploadsPlaylistId
  //    và đếm số video mới nhất. KHÔNG ghi vào Post (V2 read-only).
  // ============================================================
  async syncChannelVideos(
    channelId: string,
    maxResults = 50,
  ): Promise<SyncVideosResult> {
    if (maxResults < 1 || maxResults > 50) {
      throw new BadRequestException('maxResults phải trong [1, 50]');
    }
    const channel = await this.loadYouTubeChannel(channelId);
    const meta = (channel.metadata as Record<string, unknown>) ?? {};

    // Lấy uploads playlist ID — cache trong metadata để tiết kiệm quota
    let uploadsPlaylistId = meta.uploadsPlaylistId as string | undefined;
    if (!uploadsPlaylistId) {
      const data = await this.withTokenRefresh(channel, (token) =>
        this.api.request<YouTubeChannelsResponse>(
          `${YT.V3}/channels?part=contentDetails&id=${channel.accountId}`,
          {},
          token,
        ),
      );
      uploadsPlaylistId =
        data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylistId) {
        throw new YouTubeApiError(
          404,
          'no_uploads_playlist',
          'Channel không có uploads playlist (kênh chưa active?)',
        );
      }
      await this.prisma.channel.update({
        where: { id: channelId },
        data: {
          metadata: {
            ...meta,
            uploadsPlaylistId,
          } as Prisma.InputJsonValue,
        },
      });
    }

    // Lấy danh sách video IDs từ playlist
    const playlistData = await this.withTokenRefresh(channel, (token) =>
      this.api.request<YouTubePlaylistItemsResponse>(
        `${YT.V3}/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}`,
        {},
        token,
      ),
    );
    const videoIds = (playlistData.items ?? [])
      .map((i) => i.contentDetails?.videoId)
      .filter((id): id is string => !!id);

    return {
      channelId,
      videosFetched: videoIds.length,
    };
  }

  // ============================================================
  // 3. checkMonetizationStatus
  // ============================================================
  async checkMonetizationStatus(channelId: string): Promise<MonetizationStatus> {
    const channel = await this.loadYouTubeChannel(channelId);

    // auditDetails cần scope youtubepartner-channel-audit (limited access).
    // Nếu thiếu scope → field undefined; ta vẫn fallback sang status + statistics.
    const data = await this.withTokenRefresh(channel, (token) =>
      this.api.request<YouTubeChannelsResponse>(
        `${YT.V3}/channels?part=status,statistics,auditDetails&id=${channel.accountId}`,
        {},
        token,
      ),
    );
    const ch = data.items?.[0];
    if (!ch) throw new NotFoundException('Channel không tồn tại trên YouTube');

    const status = ch.status ?? {};
    const audit = ch.auditDetails ?? {};
    const meta = (channel.metadata as Record<string, unknown>) ?? {};
    const subs = Number(ch.statistics?.subscriberCount ?? 0);

    const warnings: string[] = [];
    const strikes: MonetizationStatus['strikes'] = [];

    if (status.madeForKids) {
      warnings.push('Channel "Made for Kids" — bị giới hạn monetization');
    }
    if (status.privacyStatus && status.privacyStatus !== 'public') {
      warnings.push(`Privacy status = ${status.privacyStatus}`);
    }
    if (status.isLinked === false) {
      warnings.push('Channel chưa link với YouTube account');
    }
    if (audit.communityGuidelinesGoodStanding === false) {
      warnings.push('Community Guidelines không tốt');
      strikes.push({
        type: 'community_guidelines',
        description: 'Channel có vi phạm Community Guidelines active',
      });
    }
    if (audit.copyrightStrikesGoodStanding === false) {
      warnings.push('Có copyright strikes active');
      strikes.push({
        type: 'copyright_strike',
        description:
          'Có copyright strike chưa giải quyết — không thể monetize cho đến khi clear',
      });
    }
    if (audit.contentIdClaimsGoodStanding === false) {
      warnings.push('Content ID claims không tốt');
    }

    const monetized =
      meta.monetizationEnabled === true ||
      (subs >= 1000 &&
        audit.copyrightStrikesGoodStanding !== false &&
        audit.communityGuidelinesGoodStanding !== false &&
        !status.madeForKids);

    return {
      monetized,
      strikes,
      warnings,
      details: {
        subscribers: subs,
        videoCount: Number(ch.statistics?.videoCount ?? 0),
        privacyStatus: status.privacyStatus ?? null,
        madeForKids: status.madeForKids ?? null,
        isLinked: status.isLinked ?? null,
        communityGuidelinesGoodStanding:
          audit.communityGuidelinesGoodStanding ?? null,
        copyrightStrikesGoodStanding: audit.copyrightStrikesGoodStanding ?? null,
        contentIdClaimsGoodStanding: audit.contentIdClaimsGoodStanding ?? null,
      },
    };
  }

  // ============================================================
  // ─── PRIVATE HELPERS ───
  // ============================================================

  private async loadYouTubeChannel(channelId: string): Promise<ChannelWithToken> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_SELECT,
    });
    if (!channel) throw new NotFoundException(`Channel ${channelId} không tồn tại`);
    if (channel.platform !== Platform.YOUTUBE) {
      throw new BadRequestException(
        `Channel ${channelId} platform=${channel.platform}, không phải YOUTUBE`,
      );
    }
    if (!channel.accessToken) {
      throw new BadRequestException(`Channel ${channelId} chưa có access token`);
    }
    return channel;
  }

  /**
   * Lấy access token hợp lệ — pre-emptive refresh nếu sắp expire,
   * hoặc retry 1 lần nếu API trả TokenExpiredError.
   */
  private async withTokenRefresh<T>(
    channel: ChannelWithToken,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    let token = await this.getCurrentAccessToken(channel);
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof TokenExpiredError) || !channel.refreshToken) {
        if (e instanceof RateLimitedError) {
          // Re-throw with masked context
          this.logger.warn(
            `YT rate-limited cho ${channel.id}, retry sau ${e.retryAfterSec}s`,
          );
        }
        throw e;
      }
      // Token expired during call → refresh + retry once
      this.logger.log(`Token expired mid-call ${channel.id}, refreshing...`);
      token = await this.refreshAndStore(channel);
      return fn(token);
    }
  }

  private async getCurrentAccessToken(
    channel: ChannelWithToken,
  ): Promise<string> {
    if (!channel.accessToken) throw new TokenExpiredError('Không có access token');

    // Pre-emptive refresh
    if (
      channel.tokenExpiresAt &&
      channel.tokenExpiresAt.getTime() < Date.now() + TOKEN_REFRESH_BUFFER_MS
    ) {
      this.logger.log(
        `Token sắp expire (${channel.tokenExpiresAt.toISOString()}), pre-refresh ${channel.id}`,
      );
      return this.refreshAndStore(channel);
    }
    try {
      return decryptToken(channel.accessToken);
    } catch (e) {
      throw new TokenExpiredError(`Decrypt token lỗi: ${(e as Error).message}`);
    }
  }

  private async refreshAndStore(channel: ChannelWithToken): Promise<string> {
    if (!channel.refreshToken) {
      await this.markTokenExpired(channel.id);
      throw new TokenExpiredError('Không có refresh_token để refresh');
    }
    const refresh = decryptToken(channel.refreshToken);

    const res = await fetch(YT.TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: requireEnv('YOUTUBE_CLIENT_ID'),
        client_secret: requireEnv('YOUTUBE_CLIENT_SECRET'),
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      // Refresh token revoked / invalid — mark TOKEN_EXPIRED, user phải reconnect
      await this.markTokenExpired(channel.id);
      const txt = await res.text().catch(() => '');
      throw new TokenExpiredError(
        `Refresh failed HTTP ${res.status}: ${txt.slice(0, 100)}`,
      );
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token ?? refresh; // Google không luôn trả mới
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: {
        accessToken: encryptToken(newAccessToken),
        refreshToken: encryptToken(newRefreshToken),
        tokenExpiresAt: expiresAt,
        status: ChannelStatus.ACTIVE,
      },
    });
    this.logger.log(
      `Refreshed token cho ${channel.id} (token: ${maskToken(newAccessToken)})`,
    );
    return newAccessToken;
  }

  private async markTokenExpired(channelId: string): Promise<void> {
    await this.prisma.channel
      .update({
        where: { id: channelId },
        data: { status: ChannelStatus.INACTIVE, lastSyncError: 'TOKEN_EXPIRED' },
      })
      .catch(() => {
        /* ignore */
      });
  }

  /** Re-throw helper để filter có thể catch VideoProcessingError nếu gọi từ caller khác. */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  private _exposeErrorTypes() {
    return { VideoProcessingError };
  }
}

// ────────── Local helpers ──────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function startOfUTCDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86_400_000);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ────────── YouTube API response shapes (subset) ──────────

type YouTubeAnalyticsResponse = {
  rows?: Array<unknown[]>;
  columnHeaders?: Array<{ name: string; columnType: string; dataType: string }>;
};

type YouTubeChannelsResponse = {
  items?: Array<{
    id: string;
    snippet?: {
      title?: string;
      customUrl?: string;
      country?: string;
      thumbnails?: { default?: { url: string }; high?: { url: string } };
    };
    statistics?: {
      viewCount?: string | number;
      subscriberCount?: string | number;
      videoCount?: string | number;
    };
    status?: {
      privacyStatus?: string;
      isLinked?: boolean;
      madeForKids?: boolean;
      longUploadsStatus?: string;
    };
    auditDetails?: {
      overallGoodStanding?: boolean;
      communityGuidelinesGoodStanding?: boolean;
      copyrightStrikesGoodStanding?: boolean;
      contentIdClaimsGoodStanding?: boolean;
    };
    contentDetails?: {
      relatedPlaylists?: { uploads?: string };
    };
  }>;
};

type YouTubePlaylistItemsResponse = {
  items?: Array<{
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
  }>;
};
