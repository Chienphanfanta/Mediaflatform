# Skill: Platform Integrations — Media Ops Platform

> Đọc file này trước khi viết bất kỳ code nào liên quan đến social media APIs.

---

## OAuth Setup — Từng Platform

### YouTube (Google OAuth 2.0)
```
Console: https://console.cloud.google.com
APIs cần enable: YouTube Data API v3, YouTube Analytics API, YouTube Reporting API
Scopes:
  - https://www.googleapis.com/auth/youtube.readonly    (xem thông tin kênh)
  - https://www.googleapis.com/auth/youtube.upload      (upload video)
  - https://www.googleapis.com/auth/yt-analytics.readonly (analytics)
  - https://www.googleapis.com/auth/youtube.force-ssl   (required cho upload)
Token lifetime: Access token 1 giờ, Refresh token không expire (trừ khi revoke)
```

### Facebook Pages + Instagram Business
```
Console: https://developers.facebook.com
App type: Business
Permissions cần xin:
  - pages_read_engagement    (đọc insights)
  - pages_manage_posts       (đăng bài)
  - instagram_basic          (đọc IG profile)
  - instagram_content_publish (đăng lên IG)
  - pages_show_list          (list pages user quản lý)
Token lifetime: User access token 2 giờ, long-lived token 60 ngày, Page token không expire
QUAN TRỌNG: Cần dùng long-lived token (exchange qua endpoint /oauth/access_token?grant_type=fb_exchange_token)
```

### X (Twitter) — OAuth 2.0 PKCE
```
Console: https://developer.twitter.com
App type: Web App
Scopes:
  - tweet.read
  - tweet.write
  - users.read
  - offline.access    (để refresh token)
Token lifetime: Access token 2 giờ (với offline.access), Refresh token 6 tháng
PKCE flow: tạo code_verifier (random 43-128 chars) + code_challenge = base64url(sha256(verifier))
```

### Telegram (Bot Token — không dùng OAuth)
```
Tạo bot: chat với @BotFather trên Telegram → /newbot
Lấy Bot Token: XXXXXXXXX:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Token: permanent (không expire)
Để post vào channel: thêm bot làm admin của channel
API: https://api.telegram.org/bot{TOKEN}/methodName
```

### WhatsApp Business API
```
Console: https://developers.facebook.com (Meta Business Suite)
Cần: Meta Business Account verified
Phone Number ID + WhatsApp Business Account ID
Token: permanent system user token
```

---

## Token Encryption — Lưu an toàn

```typescript
// /apps/api/src/common/crypto.util.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex') // 32 bytes = 64 hex chars

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv:tag:encrypted (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptToken(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const data = Buffer.from(dataHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(tag)
  return decipher.update(data) + decipher.final('utf8')
}

// Generate ENCRYPTION_KEY:
// node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Rate Limits — Tránh bị ban

| Platform   | Limit                          | Strategy                              |
|------------|--------------------------------|---------------------------------------|
| YouTube    | 10,000 quota units/day         | Cache aggressively, track usage Redis |
| Facebook   | 200 calls/user/hour            | Batch requests, cache 1h              |
| Instagram  | 200 calls/user/hour            | Shared limit với Facebook             |
| X          | 300 reads/15min, 100 posts/day | Queue posts, cache reads              |
| Telegram   | 30 messages/second             | Rate limit với p-limit library        |
| WhatsApp   | 1000 msgs/day per number       | Track daily count in Redis            |

```typescript
// Rate limiting với p-limit
import pLimit from 'p-limit'
const telegramLimit = pLimit(5) // max 5 concurrent Telegram API calls

await Promise.all(
  channels.map(ch => telegramLimit(() => sendMessage(ch.chatId, message)))
)
```

---

## Error Handling — Các lỗi thường gặp

```typescript
export class PlatformApiError extends Error {
  constructor(
    message: string,
    public platform: Platform,
    public code: string,
    public retryable: boolean = false
  ) { super(message) }
}

// YouTube errors
function handleYouTubeError(error: any): never {
  const code = error?.errors?.[0]?.reason
  switch (code) {
    case 'quotaExceeded':
      throw new PlatformApiError('YouTube quota hết hôm nay', 'YOUTUBE', 'QUOTA_EXCEEDED', false)
    case 'forbidden':
      throw new PlatformApiError('Token không đủ quyền', 'YOUTUBE', 'FORBIDDEN', false)
    case 'videoNotFound':
      throw new PlatformApiError('Video không tồn tại', 'YOUTUBE', 'NOT_FOUND', false)
    default:
      throw new PlatformApiError(`YouTube API error: ${error.message}`, 'YOUTUBE', 'UNKNOWN', true)
  }
}

// Facebook errors
function handleFacebookError(error: any): never {
  const code = error?.code
  switch (code) {
    case 190: throw new PlatformApiError('Token đã hết hạn', 'FACEBOOK', 'TOKEN_EXPIRED', false)
    case 200: throw new PlatformApiError('Không đủ quyền', 'FACEBOOK', 'FORBIDDEN', false)
    case 4:   throw new PlatformApiError('Rate limit', 'FACEBOOK', 'RATE_LIMIT', true)
    default:  throw new PlatformApiError(error.message, 'FACEBOOK', 'UNKNOWN', true)
  }
}
```

---

## Retry với Exponential Backoff

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options = { maxAttempts: 3, baseDelayMs: 1000 }
): Promise<T> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (error instanceof PlatformApiError && !error.retryable) throw error
      if (attempt === options.maxAttempts) throw error
      
      const delay = options.baseDelayMs * Math.pow(2, attempt - 1) // 1s, 2s, 4s
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('Unreachable')
}

// Usage:
const result = await withRetry(() => youtubeService.getChannelStats(channelId))
```

---

## Sandbox / Test Mode

```typescript
// Không đăng thật lên social media khi test
// Dùng environment variable để mock

if (process.env.PLATFORM_MOCK === 'true') {
  return {
    platformPostId: `mock-${Date.now()}`,
    publishedAt: new Date(),
    url: `https://example.com/mock-post`
  }
}

// .env.test
PLATFORM_MOCK=true

// Hoặc dùng MSW (Mock Service Worker) cho integration tests
// handlers/youtube.ts
rest.get('https://www.googleapis.com/youtube/v3/*', (req, res, ctx) => {
  return res(ctx.json({ items: [mockChannel] }))
})
```

---

## Facebook Long-lived Token Exchange

```typescript
// PHẢI làm này sau khi nhận user access token từ OAuth
async function getLongLivedToken(shortToken: string): Promise<string> {
  const response = await fetch(
    `https://graph.facebook.com/oauth/access_token?` +
    `grant_type=fb_exchange_token&` +
    `client_id=${FB_APP_ID}&` +
    `client_secret=${FB_APP_SECRET}&` +
    `fb_exchange_token=${shortToken}`
  )
  const data = await response.json()
  return data.access_token // Valid 60 ngày
}

// Lấy page access token từ long-lived user token (page token KHÔNG expire)
async function getPageToken(userId: string, pageId: string, userToken: string): Promise<string> {
  const response = await fetch(
    `https://graph.facebook.com/${userId}/accounts?access_token=${userToken}`
  )
  const { data } = await response.json()
  const page = data.find((p: any) => p.id === pageId)
  return page.access_token // Page token — permanent!
}
```

---

## Webhook Setup (Facebook/Instagram)

```
1. Trong Facebook App Dashboard → Webhooks → Subscribe to page events
2. Verify token: random string lưu trong env FB_WEBHOOK_VERIFY_TOKEN
3. Callback URL: https://yourdomain.com/api/v1/webhooks/facebook

Events cần subscribe:
- feed (new posts, comments)
- mentions
- messages (nếu cần)
```

```typescript
// /api/v1/webhooks/facebook/route.ts
export async function GET(req: NextRequest) {
  // Verification handshake
  const mode = req.nextUrl.searchParams.get('hub.mode')
  const token = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')
  
  if (mode === 'subscribe' && token === process.env.FB_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  // Process webhook events async
  await webhookQueue.add('facebook-event', body)
  return new Response('OK', { status: 200 })
}
```
