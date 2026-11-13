// TikTok Integration Service — V2 read-only: snapshot metrics hằng ngày.
//
// Dùng TikTok API v2 (Login Kit + Display API):
//   - GET  /v2/user/info/   → follower_count, likes_count, video_count  (scope user.info.basic + user.info.stats)
//   - POST /v2/video/list/  → view/like/comment/share của video gần đây  (scope video.list)
//
// TikTok KHÔNG có endpoint insights theo ngày như YouTube Analytics / FB Insights.
// Vì vậy mỗi lần sync chỉ ghi 1 snapshot cho NGÀY HÔM NAY:
//   - subscribers      = follower_count hiện tại
//   - subscriberDelta  = so với snapshot gần nhất trước hôm nay
//   - views            = tổng view của các video gần đây tăng thêm so với snapshot trước
//   - engagementRate   = (like + comment + share) / view của các video gần đây × 100
//
// Token: access_token sống 24h, refresh_token 365 ngày → luôn refresh khi sắp hết hạn.
// LƯU Ý: KHÔNG log plaintext token — dùng maskToken() nếu cần debug.
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Channel, ChannelStatus, Platform, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../lib/redis.service';
import { decryptToken, encryptToken, maskToken } from '../../lib/token-encryption';

// ────────── Types ──────────

export type TikTokSyncResult = {
  channelId: string;
  daysFetched: number;
  rowsUpserted: number;
  skippedReason?: 'rate-limited' | 'no-data';
  retryAfterSec?: number;
};

export class TikTokApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TikTokApiError';
  }
}

export class TikTokTokenExpiredError extends TikTokApiError {
  constructor(message = 'TikTok access token hết hạn hoặc bị thu hồi') {
    super(401, 'access_token_invalid', message);
    this.name = 'TikTokTokenExpiredError';
  }
}

// ────────── Constants ──────────

export const TIKTOK = {
  API: 'https://open.tiktokapis.com/v2',
  TOKEN: 'https://open.tiktokapis.com/v2/oauth/token/',
} as const;

const RATE_LIMIT_KEY = (channelId: string) => `tiktok:sync:${channelId}`;
const RATE_LIMIT_WINDOW_SEC = 60 * 60; // 1 giờ
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000; // refresh nếu < 10 phút còn lại
const VIDEO_PAGE_SIZE = 20; // max TikTok cho phép
const VIDEO_MAX_PAGES = 5; // tối đa 100 video gần nhất mỗi lần sync

const USER_FIELDS = [
  'open_id',
  'display_name',
  'username',
  'avatar_url',
  'follower_count',
  'following_count',
  'likes_count',
  'video_count',
].join(',');

const VIDEO_FIELDS = ['id', 'view_count', 'like_count', 'comment_count', 'share_count'].join(',');

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

type TikTokChannel = Pick<Channel, keyof typeof CHANNEL_SELECT>;

type TikTokEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
};

type TikTokUserInfo = {
  user?: {
    open_id?: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
    follower_count?: number;
    following_count?: number;
    likes_count?: number;
    video_count?: number;
  };
};

type TikTokVideoList = {
  videos?: Array<{
    id: string;
    view_count?: number;
    like_count?: number;
    comment_count?: number;
    share_count?: number;
  }>;
  cursor?: number;
  has_more?: boolean;
};

type RecentVideoStats = {
  videos: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
};

// ────────── Service ──────────

@Injectable()
export class TikTokService {
  private readonly logger = new Logger(TikTokService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async syncAccountStats(channelId: string): Promise<TikTokSyncResult> {
    const channel = await this.loadTikTokChannel(channelId);

    const rl = await this.redis.checkRateLimit(RATE_LIMIT_KEY(channelId), RATE_LIMIT_WINDOW_SEC);
    if (!rl.allowed) {
      return {
        channelId,
        daysFetched: 0,
        rowsUpserted: 0,
        skippedReason: 'rate-limited',
        retryAfterSec: rl.ttl,
      };
    }

    const info = await this.withTokenRefresh(channel, (token) =>
      this.request<TikTokUserInfo>(`/user/info/?fields=${USER_FIELDS}`, token),
    );
    const user = info.user;
    if (!user) {
      await this.redis.del(RATE_LIMIT_KEY(channelId));
      return { channelId, daysFetched: 0, rowsUpserted: 0, skippedReason: 'no-data' };
    }

    // video.list có thể chưa được cấp scope → không fail cả lần sync
    const recent = await this.withTokenRefresh(channel, (token) =>
      this.fetchRecentVideoStats(token),
    ).catch((e: Error) => {
      this.logger.warn(`TikTok video.list fail ${channelId}: ${e.message}`);
      return null;
    });

    const today = startOfUTCDay(new Date());
    const prev = await this.prisma.analytics.findFirst({
      where: { channelId, date: { lt: today } },
      orderBy: { date: 'desc' },
      select: { subscribers: true, raw: true },
    });
    const prevRecentViews = readNumber(prev?.raw, 'recentVideoViews');

    const followers = Number(user.follower_count ?? 0);
    const subscriberDelta = prev ? followers - prev.subscribers : 0;
    const views =
      recent && prevRecentViews !== null ? Math.max(0, recent.views - prevRecentViews) : 0;
    const engagementRate =
      recent && recent.views > 0
        ? ((recent.likes + recent.comments + recent.shares) / recent.views) * 100
        : 0;

    const raw = {
      followerCount: followers,
      followingCount: Number(user.following_count ?? 0),
      likesCount: Number(user.likes_count ?? 0),
      videoCount: Number(user.video_count ?? 0),
      recentVideos: recent?.videos ?? null,
      recentVideoViews: recent?.views ?? null,
      recentVideoLikes: recent?.likes ?? null,
      recentVideoComments: recent?.comments ?? null,
      recentVideoShares: recent?.shares ?? null,
    } as Prisma.InputJsonValue;

    await this.prisma.analytics.upsert({
      where: { channelId_date: { channelId, date: today } },
      create: {
        tenantId: channel.tenantId,
        channelId,
        date: today,
        platform: Platform.TIKTOK,
        views,
        subscribers: followers,
        subscriberDelta,
        engagementRate,
        raw,
        fetchedAt: new Date(),
      },
      update: {
        views,
        subscribers: followers,
        subscriberDelta,
        engagementRate,
        raw,
        fetchedAt: new Date(),
      },
    });

    const meta = (channel.metadata as Record<string, unknown> | null) ?? {};
    await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        metadata: {
          ...meta,
          followersCount: followers,
          likesCount: Number(user.likes_count ?? 0),
          videoCount: Number(user.video_count ?? 0),
          username: user.username ?? meta.username ?? null,
          displayName: user.display_name ?? meta.displayName ?? null,
          avatarUrl: user.avatar_url ?? meta.avatarUrl ?? null,
          lastSyncedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    return { channelId, daysFetched: 1, rowsUpserted: 1 };
  }

  // ============================================================
  // ─── PRIVATE HELPERS ───
  // ============================================================

  private async fetchRecentVideoStats(token: string): Promise<RecentVideoStats> {
    const acc: RecentVideoStats = { videos: 0, views: 0, likes: 0, comments: 0, shares: 0 };
    let cursor: number | undefined;
    for (let page = 0; page < VIDEO_MAX_PAGES; page++) {
      const body: Record<string, number> = { max_count: VIDEO_PAGE_SIZE };
      if (cursor !== undefined) body.cursor = cursor;
      const data = await this.request<TikTokVideoList>(
        `/video/list/?fields=${VIDEO_FIELDS}`,
        token,
        { method: 'POST', body: JSON.stringify(body) },
      );
      for (const v of data.videos ?? []) {
        acc.videos++;
        acc.views += Number(v.view_count ?? 0);
        acc.likes += Number(v.like_count ?? 0);
        acc.comments += Number(v.comment_count ?? 0);
        acc.shares += Number(v.share_count ?? 0);
      }
      if (!data.has_more || data.cursor === undefined) break;
      cursor = data.cursor;
    }
    return acc;
  }

  private async request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${TIKTOK.API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const json = (await res.json().catch(() => ({}))) as TikTokEnvelope<T>;
    const code = json.error?.code ?? (res.ok ? 'ok' : `http_${res.status}`);
    if (code === 'access_token_invalid' || res.status === 401) {
      throw new TikTokTokenExpiredError(json.error?.message);
    }
    if (!res.ok || code !== 'ok') {
      throw new TikTokApiError(res.status, code, `TikTok ${path}: ${json.error?.message ?? code}`);
    }
    if (!json.data) {
      throw new TikTokApiError(res.status, 'no_data', `TikTok ${path}: response không có data`);
    }
    return json.data;
  }

  private async loadTikTokChannel(channelId: string): Promise<TikTokChannel> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_SELECT,
    });
    if (!channel) throw new NotFoundException(`Channel ${channelId} không tồn tại`);
    if (channel.platform !== Platform.TIKTOK) {
      throw new BadRequestException(
        `Channel ${channelId} platform=${channel.platform}, không phải TIKTOK`,
      );
    }
    if (!channel.accessToken) {
      throw new BadRequestException(`Channel ${channelId} chưa có access token`);
    }
    return channel;
  }

  private async withTokenRefresh<T>(
    channel: TikTokChannel,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const token = await this.getCurrentAccessToken(channel);
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof TikTokTokenExpiredError) || !channel.refreshToken) throw e;
      this.logger.log(`TikTok token expired mid-call ${channel.id}, refreshing...`);
      return fn(await this.refreshAndStore(channel));
    }
  }

  private async getCurrentAccessToken(channel: TikTokChannel): Promise<string> {
    if (!channel.accessToken) throw new TikTokTokenExpiredError('Không có access token');
    if (
      channel.tokenExpiresAt &&
      channel.tokenExpiresAt.getTime() < Date.now() + TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.refreshAndStore(channel);
    }
    try {
      return decryptToken(channel.accessToken);
    } catch (e) {
      throw new TikTokTokenExpiredError(`Decrypt token lỗi: ${(e as Error).message}`);
    }
  }

  private async refreshAndStore(channel: TikTokChannel): Promise<string> {
    if (!channel.refreshToken) {
      await this.markTokenExpired(channel.id);
      throw new TikTokTokenExpiredError('Không có refresh_token để refresh');
    }
    const refresh = decryptToken(channel.refreshToken);

    const res = await fetch(TIKTOK.TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: requireEnv('TIKTOK_CLIENT_KEY'),
        client_secret: requireEnv('TIKTOK_CLIENT_SECRET'),
        grant_type: 'refresh_token',
        refresh_token: refresh,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      await this.markTokenExpired(channel.id);
      throw new TikTokTokenExpiredError(
        `Refresh failed HTTP ${res.status}: ${data.error_description ?? data.error ?? ''}`.trim(),
      );
    }

    const newRefresh = data.refresh_token ?? refresh;
    await this.prisma.channel.update({
      where: { id: channel.id },
      data: {
        accessToken: encryptToken(data.access_token),
        refreshToken: encryptToken(newRefresh),
        tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
        status: ChannelStatus.ACTIVE,
      },
    });
    this.logger.log(`Refreshed TikTok token cho ${channel.id} (${maskToken(data.access_token)})`);
    return data.access_token;
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
}

// ────────── Local helpers ──────────

function startOfUTCDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function readNumber(raw: Prisma.JsonValue | undefined, key: string): number | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : null;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
