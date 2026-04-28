// X (Twitter) Service — API v2 (read-only).
// OAuth 2.0 user-context với refresh_token (PKCE).
//
// Endpoints chính:
//   GET  /2/users/:id/tweets?tweet.fields=...          — list tweets + metrics
//   GET  /2/users/:id?user.fields=public_metrics      — account info
//
// Xem .claude/skills/platform-integrations.md §4 cho rate limits + scope.
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelStatus,
  Platform,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../lib/redis.service';
import {
  decryptToken,
  encryptToken,
  maskToken,
} from '../../lib/token-encryption';
import {
  BasePlatformService,
  type LoadedChannel,
} from './base-platform.service';

// ────────── X API Errors ──────────

export class XApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | undefined,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'XApiError';
  }
}

export class XTokenExpiredError extends XApiError {
  constructor(message = 'X token expired or invalid') {
    super(401, 89, message);
    this.name = 'XTokenExpiredError';
  }
}

export class XRateLimitedError extends XApiError {
  constructor(public readonly retryAfterSec: number) {
    super(429, 88, `X rate limited, retry sau ${retryAfterSec}s`);
    this.name = 'XRateLimitedError';
  }
}

// ────────── Types ──────────

export type SyncTweetMetricsResult = {
  channelId: string;
  tweetsFetched: number;
  daysAggregated: number;
  rowsUpserted: number;
  skippedReason?: 'rate-limited' | 'no-data';
  retryAfterSec?: number;
};

export type AccountMetrics = {
  channelId: string;
  userId: string;
  username: string;
  name: string;
  verified: boolean;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  listedCount: number;
};

// ────────── Constants ──────────
const X_BASE = 'https://api.x.com/2';
const X_TOKEN = 'https://api.x.com/2/oauth2/token';
const SYNC_RATE_LIMIT_SEC = 60 * 60; // 1 giờ
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ────────── Service ──────────

@Injectable()
export class TwitterService extends BasePlatformService {
  protected readonly platform = Platform.X;

  constructor(
    prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super(prisma);
  }

  // ============================================================
  // 1. syncTweetMetrics
  // ============================================================
  async syncTweetMetrics(channelId: string): Promise<SyncTweetMetricsResult> {
    const channel = await this.loadChannel(channelId);

    const rl = await this.redis.checkRateLimit(
      `x:sync:${channelId}`,
      SYNC_RATE_LIMIT_SEC,
    );
    if (!rl.allowed) {
      return {
        channelId,
        tweetsFetched: 0,
        daysAggregated: 0,
        rowsUpserted: 0,
        skippedReason: 'rate-limited',
        retryAfterSec: rl.ttl,
      };
    }

    // Lấy 100 tweets gần nhất với public_metrics
    const data = await this.retry(() =>
      this.withTokenRefresh(channel, (token) =>
        this.xRequest<XTweetsResponse>(
          `${X_BASE}/users/${channel.accountId}/tweets?` +
            `max_results=100&tweet.fields=public_metrics,created_at,non_public_metrics`,
          {},
          token,
        ),
      ),
    );

    const tweets = data.data ?? [];
    if (tweets.length === 0) {
      await this.redis.del(`x:sync:${channelId}`);
      return {
        channelId,
        tweetsFetched: 0,
        daysAggregated: 0,
        rowsUpserted: 0,
        skippedReason: 'no-data',
      };
    }

    // Aggregate by date (UTC)
    type DayAgg = {
      tweetCount: number;
      impressions: number;
      likes: number;
      retweets: number;
      replies: number;
    };
    const byDate = new Map<string, DayAgg>();
    for (const t of tweets) {
      if (!t.created_at) continue;
      const dateKey = new Date(t.created_at).toISOString().slice(0, 10);
      const cur = byDate.get(dateKey) ?? {
        tweetCount: 0,
        impressions: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
      };
      const m = t.public_metrics ?? {};
      const nm = t.non_public_metrics ?? {};
      cur.tweetCount += 1;
      cur.impressions += Number(
        m.impression_count ?? nm.impression_count ?? 0,
      );
      cur.likes += Number(m.like_count ?? 0);
      cur.retweets += Number(m.retweet_count ?? 0);
      cur.replies += Number(m.reply_count ?? 0);
      byDate.set(dateKey, cur);
    }

    // Lấy current account metrics cho subscribers absolute
    const accountInfo = await this.retry(() =>
      this.withTokenRefresh(channel, (token) =>
        this.xRequest<XUserResponse>(
          `${X_BASE}/users/${channel.accountId}?user.fields=public_metrics`,
          {},
          token,
        ),
      ),
    );
    const followers = Number(
      accountInfo.data?.public_metrics?.followers_count ?? 0,
    );

    let upserted = 0;
    const sortedDates = Array.from(byDate.keys()).sort();
    for (const dateKey of sortedDates) {
      const a = byDate.get(dateKey)!;
      const engagement = a.likes + a.retweets + a.replies;
      const engagementRate =
        a.impressions > 0 ? (engagement / a.impressions) * 100 : 0;

      await this.prisma.analytics.upsert({
        where: { channelId_date: { channelId, date: new Date(dateKey) } },
        create: {
          tenantId: channel.tenantId,
          channelId,
          date: new Date(dateKey),
          platform: Platform.X,
          views: a.impressions,
          watchTimeHours: 0,
          subscribers: 0,
          subscriberDelta: 0,
          revenue: 0,
          engagementRate: Math.round(engagementRate * 100) / 100,
          impressions: a.impressions,
          clicks: 0,
          fetchedAt: new Date(),
        },
        update: {
          views: a.impressions,
          impressions: a.impressions,
          engagementRate: Math.round(engagementRate * 100) / 100,
          fetchedAt: new Date(),
        },
      });
      upserted++;
    }

    // Patch followers absolute cho ngày cuối
    if (sortedDates.length > 0) {
      const last = sortedDates[sortedDates.length - 1];
      await this.prisma.analytics
        .update({
          where: { channelId_date: { channelId, date: new Date(last) } },
          data: { subscribers: followers },
        })
        .catch(() => {});
    }

    // Update Channel.metadata
    const meta = (channel.metadata as Record<string, unknown>) ?? {};
    await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        metadata: {
          ...meta,
          followersCount: followers,
          followingCount: Number(
            accountInfo.data?.public_metrics?.following_count ?? 0,
          ),
          tweetCount: Number(
            accountInfo.data?.public_metrics?.tweet_count ?? 0,
          ),
          lastSyncedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    return {
      channelId,
      tweetsFetched: tweets.length,
      daysAggregated: byDate.size,
      rowsUpserted: upserted,
    };
  }

  // ============================================================
  // 2. getAccountMetrics
  // ============================================================
  async getAccountMetrics(channelId: string): Promise<AccountMetrics> {
    const channel = await this.loadChannel(channelId);

    const data = await this.retry(() =>
      this.withTokenRefresh(channel, (token) =>
        this.xRequest<XUserResponse>(
          `${X_BASE}/users/${channel.accountId}?user.fields=public_metrics,verified,name,username`,
          {},
          token,
        ),
      ),
    );
    const u = data.data;
    if (!u) throw new NotFoundException('User không tồn tại trên X');

    return {
      channelId,
      userId: u.id,
      username: u.username,
      name: u.name,
      verified: !!u.verified,
      followersCount: Number(u.public_metrics?.followers_count ?? 0),
      followingCount: Number(u.public_metrics?.following_count ?? 0),
      tweetCount: Number(u.public_metrics?.tweet_count ?? 0),
      listedCount: Number(u.public_metrics?.listed_count ?? 0),
    };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private async xRequest<T>(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
    accessToken: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    };
    if (init.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
    });

    if (res.status === 401) throw new XTokenExpiredError();
    if (res.status === 429) {
      const reset = Number(res.headers.get('x-rate-limit-reset') ?? 0);
      const retryAfter = reset > 0 ? Math.max(0, reset - Math.floor(Date.now() / 1000)) : 60;
      throw new XRateLimitedError(retryAfter);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const errors = (data as { errors?: Array<{ message?: string; code?: number }> }).errors;
      const first = errors?.[0];
      throw new XApiError(
        res.status,
        first?.code,
        first?.message ?? `HTTP ${res.status}`,
        data,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async withTokenRefresh<T>(
    channel: LoadedChannel,
    fn: (token: string) => Promise<T>,
  ): Promise<T> {
    let token = await this.getValidAccessToken(channel);
    try {
      return await fn(token);
    } catch (e) {
      if (e instanceof XTokenExpiredError && channel.refreshToken) {
        token = await this.refreshAndStore(channel);
        return fn(token);
      }
      throw e;
    }
  }

  private async getValidAccessToken(channel: LoadedChannel): Promise<string> {
    if (
      channel.tokenExpiresAt &&
      channel.tokenExpiresAt.getTime() < Date.now() + TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.refreshAndStore(channel);
    }
    return this.getDecryptedAccessToken(channel);
  }

  private async refreshAndStore(channel: LoadedChannel): Promise<string> {
    if (!channel.refreshToken) {
      await this.markTokenExpired(channel.id);
      throw new XTokenExpiredError('Không có refresh_token để refresh');
    }
    const refresh = decryptToken(channel.refreshToken);

    const auth =
      'Basic ' +
      Buffer.from(
        `${requireEnv('X_CLIENT_ID')}:${requireEnv('X_CLIENT_SECRET')}`,
      ).toString('base64');

    const res = await fetch(X_TOKEN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: auth,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
      }),
    });
    if (!res.ok) {
      await this.markTokenExpired(channel.id);
      throw new XTokenExpiredError(`Refresh fail HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const newToken = data.access_token;
    const newRefresh = data.refresh_token ?? refresh;
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: {
        accessToken: encryptToken(newToken),
        refreshToken: encryptToken(newRefresh),
        tokenExpiresAt: expiresAt,
        status: ChannelStatus.ACTIVE,
      },
    });
    this.logger.log(
      `Refreshed X token cho ${channel.id} (${maskToken(newToken)})`,
    );
    return newToken;
  }

  private async markTokenExpired(channelId: string): Promise<void> {
    await this.prisma.channel
      .update({
        where: { id: channelId },
        data: { status: ChannelStatus.INACTIVE, lastSyncError: 'TOKEN_EXPIRED' },
      })
      .catch(() => {});
  }
}

// ────────── Local helpers ──────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ────────── X API response shapes ──────────

type XTweetsResponse = {
  data?: Array<{
    id: string;
    text: string;
    created_at?: string;
    public_metrics?: {
      retweet_count?: number;
      reply_count?: number;
      like_count?: number;
      quote_count?: number;
      bookmark_count?: number;
      impression_count?: number;
    };
    non_public_metrics?: {
      impression_count?: number;
    };
  }>;
  meta?: { result_count?: number; next_token?: string };
};

type XUserResponse = {
  data?: {
    id: string;
    name: string;
    username: string;
    verified?: boolean;
    public_metrics?: {
      followers_count?: number;
      following_count?: number;
      tweet_count?: number;
      listed_count?: number;
    };
  };
};
