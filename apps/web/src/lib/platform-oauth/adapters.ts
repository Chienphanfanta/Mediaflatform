// 3 platform adapters (YouTube, Facebook, TikTok) trong 1 file để tránh fragmentation.
// V2 READ-ONLY: chỉ xin scope đọc metrics — KHÔNG xin quyền đăng/sửa nội dung.
// Mỗi adapter implement OAuthAdapter interface từ ./base.ts.
import { Platform } from '@prisma/client';
import type {
  AccountInfo,
  AuthUrlInput,
  AuthUrlResult,
  ExchangeInput,
  OAuthAdapter,
  TokenSet,
  VerifyResult,
} from './base';
import { reqEnv } from './base';

// ============================================================
// 1. YOUTUBE — Google OAuth 2.0
// ============================================================
const YT_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const YT_TOKEN = 'https://oauth2.googleapis.com/token';
const YT_REVOKE = 'https://oauth2.googleapis.com/revoke';
const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

async function ytFetchChannel(accessToken: string): Promise<AccountInfo> {
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`YouTube channels.list HTTP ${res.status}`);
  const data = (await res.json()) as { items?: Array<Record<string, any>> };
  const ch = data.items?.[0];
  if (!ch) throw new Error('Không tìm thấy YouTube channel của user');
  return {
    externalId: ch.id,
    name: ch.snippet.title,
    metadata: {
      channelId: ch.id,
      channelHandle: ch.snippet.customUrl ?? null,
      country: ch.snippet.country ?? null,
      defaultLanguage: ch.snippet.defaultLanguage ?? null,
      thumbnailUrl: ch.snippet.thumbnails?.default?.url ?? null,
      subscriberCount: Number(ch.statistics.subscriberCount ?? 0),
      viewCount: Number(ch.statistics.viewCount ?? 0),
      videoCount: Number(ch.statistics.videoCount ?? 0),
    },
  };
}

export const youtubeAdapter: OAuthAdapter = {
  platform: Platform.YOUTUBE,

  generateAuthUrl({ state, redirectUri }: AuthUrlInput): AuthUrlResult {
    const u = new URL(YT_AUTH);
    u.searchParams.set('client_id', reqEnv('YOUTUBE_CLIENT_ID'));
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', YT_SCOPES.join(' '));
    u.searchParams.set('access_type', 'offline'); // bắt buộc để có refresh_token
    u.searchParams.set('prompt', 'consent'); // ép trả refresh_token mỗi lần
    u.searchParams.set('state', state);
    return { url: u.toString() };
  },

  async exchangeCode({ code, redirectUri }): Promise<TokenSet> {
    const res = await fetch(YT_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: reqEnv('YOUTUBE_CLIENT_ID'),
        client_secret: reqEnv('YOUTUBE_CLIENT_SECRET'),
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`YouTube token exchange HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as Record<string, any>;
    const account = await ytFetchChannel(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      scope: data.scope ?? null,
      account,
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
    const res = await fetch(YT_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: reqEnv('YOUTUBE_CLIENT_ID'),
        client_secret: reqEnv('YOUTUBE_CLIENT_SECRET'),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`YouTube refresh HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, any>;
    const account = await ytFetchChannel(data.access_token);
    return {
      accessToken: data.access_token,
      // Google KHÔNG luôn trả refresh_token mới — giữ cũ nếu vắng
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      scope: data.scope ?? null,
      account,
    };
  },

  async revokeToken(accessToken: string): Promise<void> {
    // Best effort — không throw
    await fetch(`${YT_REVOKE}?token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
    }).catch(() => {});
  },

  async verifyToken(accessToken: string): Promise<VerifyResult> {
    try {
      const account = await ytFetchChannel(accessToken);
      return { valid: true, account: { externalId: account.externalId, name: account.name } };
    } catch (e) {
      return { valid: false, reason: (e as Error).message };
    }
  },
};

// ============================================================
// 2. FACEBOOK — Meta Graph API
// ============================================================
const FB_VERSION = 'v18.0';
const FB_AUTH = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const FB_TOKEN = `https://graph.facebook.com/${FB_VERSION}/oauth/access_token`;
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;
const FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'read_insights',
];

async function fbExchangeLongLived(shortToken: string): Promise<{ token: string; expiresIn: number | null }> {
  const u = new URL(FB_TOKEN);
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_id', reqEnv('META_APP_ID'));
  u.searchParams.set('client_secret', reqEnv('META_APP_SECRET'));
  u.searchParams.set('fb_exchange_token', shortToken);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`FB long-lived exchange HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, any>;
  return { token: data.access_token, expiresIn: data.expires_in ?? null };
}

async function fbFetchFirstPage(userToken: string): Promise<AccountInfo & { pageToken: string }> {
  // List pages — chọn page đầu tiên. UI có thể cho user chọn sau (Phase 1).
  const res = await fetch(
    `${FB_GRAPH}/me/accounts?fields=id,name,category,fan_count,verification_status,access_token&limit=10`,
    { headers: { Authorization: `Bearer ${userToken}` } },
  );
  if (!res.ok) throw new Error(`FB /me/accounts HTTP ${res.status}`);
  const data = (await res.json()) as { data?: Array<Record<string, any>> };
  const page = data.data?.[0];
  if (!page) throw new Error('Account này không quản lý Page nào');
  return {
    externalId: page.id,
    name: page.name,
    metadata: {
      pageId: page.id,
      pageName: page.name,
      category: page.category,
      fanCount: page.fan_count ?? 0,
      verificationStatus: page.verification_status ?? null,
    },
    pageToken: page.access_token,
  };
}

export const facebookAdapter: OAuthAdapter = {
  platform: Platform.FACEBOOK,

  generateAuthUrl({ state, redirectUri }): AuthUrlResult {
    const u = new URL(FB_AUTH);
    u.searchParams.set('client_id', reqEnv('META_APP_ID'));
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('scope', FB_SCOPES.join(','));
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    return { url: u.toString() };
  },

  async exchangeCode({ code, redirectUri }): Promise<TokenSet> {
    const u = new URL(FB_TOKEN);
    u.searchParams.set('client_id', reqEnv('META_APP_ID'));
    u.searchParams.set('client_secret', reqEnv('META_APP_SECRET'));
    u.searchParams.set('code', code);
    u.searchParams.set('redirect_uri', redirectUri);
    const res = await fetch(u);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`FB exchange HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as Record<string, any>;
    // Đổi short-lived → long-lived (~60 ngày)
    const long = await fbExchangeLongLived(data.access_token);
    // Lấy Page đầu tiên + page access token
    const pageInfo = await fbFetchFirstPage(long.token);
    return {
      // Lưu PAGE access token (đọc insights), không phải user token
      accessToken: pageInfo.pageToken,
      refreshToken: null, // FB không có refresh — token Page có thể không expire
      expiresAt: long.expiresIn ? new Date(Date.now() + long.expiresIn * 1000) : null,
      scope: FB_SCOPES.join(','),
      account: {
        externalId: pageInfo.externalId,
        name: pageInfo.name,
        metadata: pageInfo.metadata,
      },
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
    // FB không có refresh_token — phải re-auth. Throw để caller handle.
    void refreshToken;
    throw new Error('Facebook không hỗ trợ refresh — yêu cầu user reconnect');
  },

  async revokeToken(accessToken: string): Promise<void> {
    await fetch(`${FB_GRAPH}/me/permissions?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'DELETE',
    }).catch(() => {});
  },

  async verifyToken(accessToken: string): Promise<VerifyResult> {
    try {
      const res = await fetch(
        `${FB_GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
      );
      if (!res.ok) return { valid: false, reason: `HTTP ${res.status}` };
      const data = (await res.json()) as { id?: string; name?: string; error?: { message: string } };
      if (data.error) return { valid: false, reason: data.error.message };
      return { valid: true, account: { externalId: data.id ?? '', name: data.name ?? '' } };
    } catch (e) {
      return { valid: false, reason: (e as Error).message };
    }
  },
};

// ============================================================
// 3. TIKTOK — TikTok Login Kit (OAuth 2.0, API v2)
// ============================================================
// access_token sống 24h, refresh_token 365 ngày.
// Scope user.info.stats + video.list cần được TikTok duyệt trong app review.
const TT_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const TT_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const TT_REVOKE = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const TT_API = 'https://open.tiktokapis.com/v2';
const TT_SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'];
const TT_USER_FIELDS = [
  'open_id',
  'display_name',
  'username',
  'avatar_url',
  'profile_deep_link',
  'follower_count',
  'following_count',
  'likes_count',
  'video_count',
].join(',');

type TikTokTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function ttFetchUser(accessToken: string): Promise<AccountInfo> {
  const res = await fetch(`${TT_API}/user/info/?fields=${TT_USER_FIELDS}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as {
    data?: {
      user?: {
        open_id?: string;
        display_name?: string;
        username?: string;
        avatar_url?: string;
        profile_deep_link?: string;
        follower_count?: number;
        following_count?: number;
        likes_count?: number;
        video_count?: number;
      };
    };
    error?: { code?: string; message?: string };
  };
  if (!res.ok || (data.error?.code && data.error.code !== 'ok')) {
    throw new Error(`TikTok user/info HTTP ${res.status}: ${data.error?.message ?? ''}`.trim());
  }
  const u = data.data?.user;
  if (!u?.open_id) throw new Error('TikTok user/info trả không có user');
  return {
    externalId: u.open_id,
    name: u.display_name ?? u.username ?? 'TikTok account',
    metadata: {
      openId: u.open_id,
      username: u.username ?? null,
      displayName: u.display_name ?? null,
      avatarUrl: u.avatar_url ?? null,
      profileUrl: u.profile_deep_link ?? (u.username ? `https://www.tiktok.com/@${u.username}` : null),
      followersCount: Number(u.follower_count ?? 0),
      followingCount: Number(u.following_count ?? 0),
      likesCount: Number(u.likes_count ?? 0),
      videoCount: Number(u.video_count ?? 0),
    },
  };
}

async function ttTokenRequest(params: Record<string, string>): Promise<TikTokTokenResponse> {
  const res = await fetch(TT_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: reqEnv('TIKTOK_CLIENT_KEY'),
      client_secret: reqEnv('TIKTOK_CLIENT_SECRET'),
      ...params,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TikTokTokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      `TikTok token HTTP ${res.status}: ${data.error_description ?? data.error ?? 'no access_token'}`,
    );
  }
  return data;
}

async function ttToTokenSet(data: TikTokTokenResponse, fallbackRefresh?: string): Promise<TokenSet> {
  const accessToken = data.access_token as string;
  const account = await ttFetchUser(accessToken);
  return {
    accessToken,
    refreshToken: data.refresh_token ?? fallbackRefresh ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scope: data.scope ?? null,
    account,
  };
}

export const tiktokAdapter: OAuthAdapter = {
  platform: Platform.TIKTOK,

  generateAuthUrl({ state, redirectUri }: AuthUrlInput): AuthUrlResult {
    const u = new URL(TT_AUTH);
    u.searchParams.set('client_key', reqEnv('TIKTOK_CLIENT_KEY'));
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', TT_SCOPES.join(','));
    u.searchParams.set('state', state);
    return { url: u.toString() };
  },

  async exchangeCode({ code, redirectUri }: ExchangeInput): Promise<TokenSet> {
    const data = await ttTokenRequest({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    return ttToTokenSet(data);
  },

  async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
    const data = await ttTokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return ttToTokenSet(data, refreshToken);
  },

  async revokeToken(accessToken: string): Promise<void> {
    await fetch(TT_REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: reqEnv('TIKTOK_CLIENT_KEY'),
        client_secret: reqEnv('TIKTOK_CLIENT_SECRET'),
        token: accessToken,
      }),
    }).catch(() => {});
  },

  async verifyToken(accessToken: string): Promise<VerifyResult> {
    try {
      const account = await ttFetchUser(accessToken);
      return { valid: true, account: { externalId: account.externalId, name: account.name } };
    } catch (e) {
      return { valid: false, reason: (e as Error).message };
    }
  },
};
