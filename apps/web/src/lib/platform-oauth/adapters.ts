// 5 platform adapters trong 1 file để tránh fragmentation.
// Mỗi adapter implement OAuthAdapter interface từ ./base.ts.
import crypto from 'node:crypto';
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
  'https://www.googleapis.com/auth/youtube.upload',
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
  'pages_manage_posts',
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
      // Lưu PAGE access token (có thể publish), không phải user token
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
// 3. INSTAGRAM — Meta Graph API (qua Facebook Page link)
// ============================================================
const IG_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
];

async function igFindBusinessAccount(userToken: string): Promise<AccountInfo> {
  // List pages → check page có instagram_business_account không
  const res = await fetch(
    `${FB_GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username,name,followers_count,follows_count,media_count,profile_picture_url}&access_token=${encodeURIComponent(userToken)}`,
  );
  if (!res.ok) throw new Error(`IG list pages HTTP ${res.status}`);
  const data = (await res.json()) as { data?: Array<Record<string, any>> };
  const pageWithIg = (data.data ?? []).find((p) => p.instagram_business_account);
  if (!pageWithIg) {
    throw new Error('Không tìm thấy IG Business Account — kiểm tra account đã link với FB Page chưa');
  }
  const ig = pageWithIg.instagram_business_account;
  return {
    externalId: ig.id,
    name: ig.name ?? ig.username,
    metadata: {
      igUserId: ig.id,
      username: ig.username,
      linkedFacebookPageId: pageWithIg.id,
      accountType: 'BUSINESS',
      followersCount: ig.followers_count ?? 0,
      followsCount: ig.follows_count ?? 0,
      mediaCount: ig.media_count ?? 0,
      profilePictureUrl: ig.profile_picture_url ?? null,
    },
  };
}

export const instagramAdapter: OAuthAdapter = {
  platform: Platform.INSTAGRAM,

  generateAuthUrl({ state, redirectUri }): AuthUrlResult {
    const u = new URL(FB_AUTH); // dùng chung auth dialog với FB
    u.searchParams.set('client_id', reqEnv('META_APP_ID'));
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('scope', IG_SCOPES.join(','));
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
      throw new Error(`IG exchange HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as Record<string, any>;
    const long = await fbExchangeLongLived(data.access_token);
    const account = await igFindBusinessAccount(long.token);
    return {
      accessToken: long.token, // user token long-lived
      refreshToken: null,
      expiresAt: long.expiresIn ? new Date(Date.now() + long.expiresIn * 1000) : null,
      scope: IG_SCOPES.join(','),
      account,
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
    void refreshToken;
    throw new Error('Instagram (Meta) không hỗ trợ refresh — user phải reconnect');
  },

  async revokeToken(accessToken: string): Promise<void> {
    await fetch(`${FB_GRAPH}/me/permissions?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'DELETE',
    }).catch(() => {});
  },

  async verifyToken(accessToken: string): Promise<VerifyResult> {
    try {
      const account = await igFindBusinessAccount(accessToken);
      return { valid: true, account: { externalId: account.externalId, name: account.name } };
    } catch (e) {
      return { valid: false, reason: (e as Error).message };
    }
  },
};

// ============================================================
// 4. X (Twitter) — OAuth 2.0 + PKCE
// ============================================================
const X_AUTH = 'https://x.com/i/oauth2/authorize';
const X_TOKEN = 'https://api.x.com/2/oauth2/token';
const X_REVOKE = 'https://api.x.com/2/oauth2/revoke';
const X_USER = 'https://api.x.com/2/users/me';
const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function xFetchUser(accessToken: string): Promise<AccountInfo> {
  const res = await fetch(
    `${X_USER}?user.fields=id,username,name,verified,public_metrics,profile_image_url`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`X /users/me HTTP ${res.status}`);
  const data = (await res.json()) as { data?: Record<string, any> };
  const u = data.data;
  if (!u) throw new Error('X /users/me trả không có data');
  return {
    externalId: u.id,
    name: u.name ?? u.username,
    metadata: {
      userId: u.id,
      username: u.username,
      verified: !!u.verified,
      followersCount: u.public_metrics?.followers_count ?? 0,
      followingCount: u.public_metrics?.following_count ?? 0,
      tweetCount: u.public_metrics?.tweet_count ?? 0,
      profileImageUrl: u.profile_image_url ?? null,
    },
  };
}

function xBasicAuth(): string {
  return (
    'Basic ' +
    Buffer.from(`${reqEnv('X_CLIENT_ID')}:${reqEnv('X_CLIENT_SECRET')}`).toString('base64')
  );
}

export const xAdapter: OAuthAdapter = {
  platform: Platform.X,

  generateAuthUrl({ state, redirectUri }): AuthUrlResult {
    const { verifier, challenge } = pkce();
    const u = new URL(X_AUTH);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', reqEnv('X_CLIENT_ID'));
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('scope', X_SCOPES.join(' '));
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return { url: u.toString(), codeVerifier: verifier };
  },

  async exchangeCode({ code, redirectUri, codeVerifier }): Promise<TokenSet> {
    if (!codeVerifier) throw new Error('X exchange thiếu codeVerifier (PKCE)');
    const res = await fetch(X_TOKEN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: xBasicAuth(),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`X exchange HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as Record<string, any>;
    const account = await xFetchUser(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      scope: data.scope ?? null,
      account,
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
    const res = await fetch(X_TOKEN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: xBasicAuth(),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`X refresh HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, any>;
    const account = await xFetchUser(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      scope: data.scope ?? null,
      account,
    };
  },

  async revokeToken(accessToken: string): Promise<void> {
    await fetch(X_REVOKE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: xBasicAuth(),
      },
      body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' }),
    }).catch(() => {});
  },

  async verifyToken(accessToken: string): Promise<VerifyResult> {
    try {
      const account = await xFetchUser(accessToken);
      return { valid: true, account: { externalId: account.externalId, name: account.name } };
    } catch (e) {
      return { valid: false, reason: (e as Error).message };
    }
  },
};

// ============================================================
// 5. TELEGRAM — Bot Token (KHÔNG dùng OAuth chuẩn)
// ============================================================
async function tgGetMe(botToken: string): Promise<AccountInfo> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  if (!res.ok) throw new Error(`Telegram getMe HTTP ${res.status}`);
  const data = (await res.json()) as {
    ok: boolean;
    result?: { id: number; username: string; first_name: string; can_join_groups?: boolean };
    description?: string;
  };
  if (!data.ok || !data.result) {
    throw new Error(data.description ?? 'Bot token invalid');
  }
  const r = data.result;
  return {
    externalId: String(r.id),
    name: `@${r.username}`,
    metadata: {
      botId: r.id,
      botUsername: r.username,
      botFirstName: r.first_name,
      canJoinGroups: r.can_join_groups ?? null,
      // chatId sẽ điền sau khi user add bot vào channel/group đích
      chatId: null,
      chatType: null,
      title: null,
    },
  };
}

export const telegramAdapter: OAuthAdapter = {
  platform: Platform.TELEGRAM,

  generateAuthUrl(): AuthUrlResult | null {
    return null; // Telegram không OAuth — caller dùng connectViaToken
  },

  async exchangeCode(): Promise<TokenSet> {
    throw new Error('Telegram không dùng OAuth code exchange');
  },

  async refreshAccessToken(): Promise<TokenSet> {
    throw new Error('Telegram bot token không cần refresh');
  },

  async revokeToken(): Promise<void> {
    // Bot token chỉ revoke được qua @BotFather (manual). No-op.
  },

  async verifyToken(accessToken: string): Promise<VerifyResult> {
    try {
      const account = await tgGetMe(accessToken);
      return { valid: true, account: { externalId: account.externalId, name: account.name } };
    } catch (e) {
      return { valid: false, reason: (e as Error).message };
    }
  },

  async connectViaToken(botToken: string, opts?: { name?: string }): Promise<TokenSet> {
    const account = await tgGetMe(botToken);
    if (opts?.name) account.name = opts.name;
    return {
      accessToken: botToken,
      refreshToken: null,
      expiresAt: null, // Bot token vĩnh viễn (đến khi revoke ở @BotFather)
      scope: 'bot',
      account,
    };
  },
};

// ============================================================
// WHATSAPP — placeholder (chưa implement)
// ============================================================
export const whatsappAdapter: OAuthAdapter = {
  platform: Platform.WHATSAPP,
  generateAuthUrl: () => null,
  exchangeCode: async () => {
    throw new Error('WhatsApp connection chưa implement (Phase 6+)');
  },
  refreshAccessToken: async () => {
    throw new Error('WhatsApp chưa implement');
  },
  revokeToken: async () => {},
  verifyToken: async () => ({ valid: false, reason: 'WhatsApp adapter chưa implement' }),
};
