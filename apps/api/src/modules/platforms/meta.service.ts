// Meta integration service — Facebook Pages (read-only insights).
//
// FACEBOOK Channel: accessToken = PAGE Access Token (lấy từ /me/accounts khi connect).
//   Page tokens long-lived thường KHÔNG expire (Meta docs) — chỉ revoke khi user
//   đổi password/permissions. tokenExpiresAt thường null.
//
// Ngoài 60 ngày → 401/190 → mark TOKEN_EXPIRED, user phải reconnect (Meta không có
// refresh_token chuẩn — chỉ exchange long-lived → long-lived khi còn hạn).
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
import {
  decryptToken,
  encryptToken,
  maskToken,
} from '../../lib/token-encryption';
import {
  META,
  MetaApiClient,
  MetaTokenExpiredError,
} from './meta-api-client';

// ────────── Types ──────────

export type SyncMetaInsightsResult = {
  channelId: string;
  daysFetched: number;
  rowsUpserted: number;
  skippedReason?: 'rate-limited' | 'no-data';
  retryAfterSec?: number;
};

// ────────── Constants ──────────
const RATE_LIMIT_WINDOW_SEC = 60 * 60; // 1 giờ — chống spam sync mỗi channel
const TOKEN_REFRESH_BUFFER_DAYS = 7; // exchange long-lived nếu < 7 ngày còn lại
const FB_INSIGHTS_LOOKBACK_DAYS = 30;

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
type MetaChannel = Pick<Channel, keyof typeof CHANNEL_SELECT>;

// ────────── Service ──────────

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly api: MetaApiClient,
  ) {}

  // ===========================================================
  // FACEBOOK
  // ===========================================================

  // 1. Sync Page insights → Analytics
  async syncPageInsights(channelId: string): Promise<SyncMetaInsightsResult> {
    const channel = await this.loadChannel(channelId, Platform.FACEBOOK);
    const rl = await this.redis.checkRateLimit(
      `meta:fb-sync:${channelId}`,
      RATE_LIMIT_WINDOW_SEC,
    );
    if (!rl.allowed) {
      return {
        channelId,
        daysFetched: 0,
        rowsUpserted: 0,
        skippedReason: 'rate-limited',
        retryAfterSec: rl.ttl,
      };
    }

    const today = startOfUTCDay(new Date());
    const since = subDays(today, FB_INSIGHTS_LOOKBACK_DAYS);
    const until = today;

    // Metrics quan trọng — period=day. 1 request lấy được nhiều metric cùng lúc.
    const metrics = [
      'page_impressions',
      'page_post_engagements',
      'page_fan_adds',
      'page_views_total',
    ].join(',');

    const data = await this.withTokenRefresh(channel, (token) =>
      this.api.request<MetaInsightsResponse>(
        `${META.GRAPH}/${channel.accountId}/insights?metric=${metrics}` +
          `&period=day&since=${isoDate(since)}&until=${isoDate(until)}`,
        {},
        token,
      ),
    );

    // Pivot: { [date]: { metric: value } }
    const byDate = new Map<string, Record<string, number>>();
    for (const m of data.data ?? []) {
      for (const v of m.values ?? []) {
        if (!v.end_time) continue;
        const d = isoDate(new Date(v.end_time));
        const cur = byDate.get(d) ?? {};
        cur[m.name] = Number(v.value ?? 0);
        byDate.set(d, cur);
      }
    }

    if (byDate.size === 0) {
      await this.redis.del(`meta:fb-sync:${channelId}`);
      return { channelId, daysFetched: 0, rowsUpserted: 0, skippedReason: 'no-data' };
    }

    // Lấy current fan_count cho subscribers absolute
    const pageInfo = await this.withTokenRefresh(channel, (token) =>
      this.api.request<{ fan_count?: number; verification_status?: string }>(
        `${META.GRAPH}/${channel.accountId}?fields=fan_count,verification_status,name`,
        {},
        token,
      ),
    );
    const currentFanCount = Number(pageInfo.fan_count ?? 0);

    let upserted = 0;
    for (const [dateKey, m] of byDate.entries()) {
      const impressions = m.page_impressions ?? 0;
      const engagements = m.page_post_engagements ?? 0;
      const subsAdds = m.page_fan_adds ?? 0;
      const profileViews = m.page_views_total ?? 0;
      const engagementRate =
        impressions > 0 ? (engagements / impressions) * 100 : 0;

      await this.prisma.analytics.upsert({
        where: { channelId_date: { channelId, date: new Date(dateKey) } },
        create: {
          tenantId: channel.tenantId,
          channelId,
          date: new Date(dateKey),
          platform: Platform.FACEBOOK,
          views: impressions, // FB: impressions ≈ "views" content
          watchTimeHours: 0, // FB không có watch time tổng (cần videos insights riêng)
          subscribers: 0, // sẽ patch ngày cuối với fan_count current
          subscriberDelta: subsAdds,
          revenue: 0, // FB không expose revenue cho non-publisher accounts
          engagementRate: Math.round(engagementRate * 100) / 100,
          impressions,
          clicks: profileViews,
          fetchedAt: new Date(),
        },
        update: {
          views: impressions,
          subscriberDelta: subsAdds,
          engagementRate: Math.round(engagementRate * 100) / 100,
          impressions,
          clicks: profileViews,
          fetchedAt: new Date(),
        },
      });
      upserted++;
    }

    // Patch absolute fan count cho ngày cuối
    const latestDay = Array.from(byDate.keys()).sort().pop();
    if (latestDay) {
      await this.prisma.analytics
        .update({
          where: { channelId_date: { channelId, date: new Date(latestDay) } },
          data: { subscribers: currentFanCount },
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
          fanCount: currentFanCount,
          lastSyncedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    return { channelId, daysFetched: byDate.size, rowsUpserted: upserted };
  }

  // ===========================================================
  // PRIVATE HELPERS
  // ===========================================================

  private async loadChannel(
    channelId: string,
    expected: Platform,
  ): Promise<MetaChannel> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_SELECT,
    });
    if (!channel) throw new NotFoundException(`Channel ${channelId} không tồn tại`);
    if (channel.platform !== expected) {
      throw new BadRequestException(
        `Channel ${channelId} platform=${channel.platform}, cần ${expected}`,
      );
    }
    if (!channel.accessToken) {
      throw new BadRequestException(`Channel ${channelId} chưa có access token`);
    }
    return channel;
  }

  private async withTokenRefresh<T>(
    channel: MetaChannel,
    fn: (token: string) => Promise<T>,
  ): Promise<T> {
    let token = await this.getValidAccessToken(channel);
    try {
      return await fn(token);
    } catch (e) {
      if (e instanceof MetaTokenExpiredError) {
        // Try exchange long-lived → long-lived (chỉ hoạt động khi token chưa expire hẳn)
        const refreshed = await this.tryRefreshLongLived(channel);
        if (refreshed) {
          return fn(refreshed);
        }
        await this.markTokenExpired(channel.id);
      }
      throw e;
    }
  }

  private async getValidAccessToken(channel: MetaChannel): Promise<string> {
    if (!channel.accessToken) throw new MetaTokenExpiredError();
    // Pre-emptive refresh nếu < 7 ngày còn lại (chỉ áp dụng khi tokenExpiresAt set,
    // tức user token; Page token thường null = không expire).
    if (channel.tokenExpiresAt) {
      const buffer = TOKEN_REFRESH_BUFFER_DAYS * 86_400_000;
      if (channel.tokenExpiresAt.getTime() < Date.now() + buffer) {
        const refreshed = await this.tryRefreshLongLived(channel);
        if (refreshed) return refreshed;
      }
    }
    try {
      return decryptToken(channel.accessToken);
    } catch (e) {
      throw new MetaTokenExpiredError(undefined, `Decrypt fail: ${(e as Error).message}`);
    }
  }

  /**
   * Exchange long-lived token → long-lived mới (extend thêm 60 ngày).
   * Trả new plaintext token, hoặc null nếu fail (caller sẽ mark TOKEN_EXPIRED).
   */
  private async tryRefreshLongLived(
    channel: MetaChannel,
  ): Promise<string | null> {
    if (!channel.accessToken) return null;
    let plain: string;
    try {
      plain = decryptToken(channel.accessToken);
    } catch {
      return null;
    }

    try {
      const u = new URL(META.TOKEN);
      u.searchParams.set('grant_type', 'fb_exchange_token');
      u.searchParams.set('client_id', requireEnv('META_APP_ID'));
      u.searchParams.set('client_secret', requireEnv('META_APP_SECRET'));
      u.searchParams.set('fb_exchange_token', plain);

      const res = await fetch(u);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!data.access_token) return null;

      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null;

      await this.prisma.channel.update({
        where: { id: channel.id },
        data: {
          accessToken: encryptToken(data.access_token),
          tokenExpiresAt: expiresAt,
          status: ChannelStatus.ACTIVE,
        },
      });
      this.logger.log(
        `Meta token refreshed cho ${channel.id} (${maskToken(data.access_token)})`,
      );
      return data.access_token;
    } catch (e) {
      this.logger.warn(`Meta refresh fail ${channel.id}: ${(e as Error).message}`);
      return null;
    }
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
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ────────── Meta API response types ──────────

type MetaInsightsResponse = {
  data?: Array<{
    name: string;
    period: string;
    values?: Array<{
      value: number | Record<string, number> | unknown;
      end_time?: string;
    }>;
  }>;
};
