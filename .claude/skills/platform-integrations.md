# Platform Integrations — per-platform cheat sheet

> Integration code CHỈ nằm ở `apps/api/src/integrations/{platform}/`. Web không gọi platform API trực tiếp.
> Xem CLAUDE.md §6 cho schema `Channel.metadata` per platform.

---

## 0. Nguyên tắc chung (áp dụng mọi platform)

### Auth & token

- OAuth access/refresh token lưu ở `Channel.accessToken` / `Channel.refreshToken`.
- **BẮT BUỘC mã hoá AES-256-GCM** trước khi ghi DB (key từ `TOKEN_ENCRYPTION_KEY` env).
- Refresh token trước khi expire (tracking `tokenExpiresAt`). Cron sweep kênh sắp expire.

```ts
// Pattern mã hoá token
import crypto from 'node:crypto';

const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'hex'); // 32 bytes
const ALGO = 'aes-256-gcm';

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptToken(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const dec = crypto.createDecipheriv(ALGO, key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}
```

### Retry + backoff (dùng BullMQ)

```ts
import { Queue } from 'bullmq';

export const publishQueue = new Queue('publish-post', {
  connection: { url: process.env.REDIS_URL },
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
});
```

Trong worker, **tôn trọng `Retry-After` header** từ platform:

```ts
if (res.status === 429) {
  const retryAfter = Number(res.headers.get('Retry-After') ?? 60);
  throw new UnrecoverableError(`Rate limited — retry in ${retryAfter}s`);
  // hoặc custom reschedule job
}
```

### Idempotency

Khi publish, luôn check `PostTarget.externalPostId` (hoặc `Post.metadata.externalId`) **trước** khi gọi API. Nếu có rồi → coi như đã đăng, không gửi lại.

```ts
if (post.metadata?.externalId) {
  logger.warn(`Post ${post.id} đã có externalId, skip publish.`);
  return { skipped: true };
}

const result = await platformApi.publish(...);
await prisma.post.update({
  where: { id: post.id },
  data: { metadata: { ...post.metadata, externalId: result.id } },
});
```

### Webhook

- Verify signature TRƯỚC khi parse body.
- Reply nhanh (< 5s) — enqueue việc nặng vào BullMQ.

```ts
@Post('webhook')
async webhook(@Req() req, @Headers('x-hub-signature-256') sig: string) {
  const body = req.rawBody;  // raw buffer cần enable in main.ts
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new ForbiddenException('Invalid signature');
  }
  await webhookQueue.add('process', { body: body.toString(), received: Date.now() });
  return { ok: true };  // trả nhanh
}
```

---

## 1. YouTube

| Mục | Chi tiết |
|-----|----------|
| **API** | YouTube Data API v3 + YouTube Analytics API v2 |
| **Auth** | OAuth 2.0 (Google) |
| **Scopes** | `https://www.googleapis.com/auth/youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`, `youtubepartner` |
| **Base URL** | `https://www.googleapis.com/youtube/v3` |
| **Quota** | **10,000 units/ngày**. Upload video ≈ 1,600 units. List channels ≈ 1 unit. Search ≈ 100 units |

### `Channel.metadata` shape

```ts
{
  channelId: string,           // UC...
  channelHandle: string,       // @example
  subscriberCount: number,
  viewCount: number,
  videoCount: number,
  country: string,             // 'VN'
  defaultLanguage: string,     // 'vi'
  madeForKids: boolean,
  monetizationEnabled: boolean,
  thumbnailUrl: string,
}
```

### Upload video — quy trình

```ts
// 1. POST /upload/youtube/v3/videos?uploadType=resumable
//    Trả về URL upload session
// 2. PUT file lên URL đó (chunk support)
// 3. GET /videos?part=snippet,status,statistics&id={videoId}
//    để lấy final metadata

const metadata = {
  snippet: {
    title: post.title.slice(0, 100),            // ≤ 100 ký tự
    description: post.content?.slice(0, 5000),   // ≤ 5000
    tags: post.metadata?.tags ?? [],
    categoryId: post.metadata?.categoryId ?? '22',
    defaultLanguage: 'vi',
  },
  status: {
    privacyStatus: post.metadata?.privacyStatus ?? 'private', // public | unlisted | private
    madeForKids: post.metadata?.madeForKids ?? false,
    selfDeclaredMadeForKids: false,
  },
};
```

### Lỗi thường gặp

| Error | Code | Xử lý |
|-------|------|-------|
| `quotaExceeded` | 403 | Dừng job, reset sau 00:00 PT (tức 15h VN). Cache analytics 1h |
| `uploadLimitExceeded` | 403 | Video dài > 12h hoặc vi phạm terms. Alert user |
| `invalidTitle` | 400 | Title có `<` `>` hoặc > 100 chars |
| `forbidden` | 403 | Token expired hoặc kênh bị suspended |

### Rate limit strategy

Cache `videos.list` + `channels.list` + analytics snapshots → Redis TTL **1h**. Đừng gọi analytics realtime — burn quota cực nhanh.

---

## 2. Facebook (Page)

| Mục | Chi tiết |
|-----|----------|
| **API** | Facebook Graph API v18.0+ |
| **Auth** | Meta OAuth 2.0 → đổi User Token → **Page Access Token (long-lived)** |
| **Scopes** | `pages_read_engagement`, `pages_manage_posts`, `pages_show_list`, `read_insights` |
| **Base URL** | `https://graph.facebook.com/v18.0` |
| **Rate limit** | 200 calls/hour/user + **Business Use Case (BUC)** limits per Page |

### `Channel.metadata` shape

```ts
{
  pageId: string,
  pageName: string,
  category: string,           // 'Media/News Company'
  fanCount: number,
  verificationStatus: string, // 'blue_verified' | 'not_verified'
  about: string,
  websiteUrl: string,
}
```

### Đăng bài

```ts
// POST https://graph.facebook.com/v18.0/{pageId}/feed
{
  message: post.content,
  link: post.metadata?.link,            // optional
  published: post.status === 'PUBLISHED',
  scheduled_publish_time: Math.floor((post.scheduledAt?.getTime() ?? 0) / 1000),
  // Photo/video: dùng endpoints /photos, /videos
}
```

Upload ảnh (multiple photos):
```ts
// 1. POST /{pageId}/photos với published=false → lấy photoId
// 2. POST /{pageId}/feed với attached_media=[{media_fbid: photoId}, ...]
```

### Lỗi thường gặp

| Code | Message | Xử lý |
|------|---------|-------|
| 190 | `Invalid OAuth access token` | Refresh/re-auth; mark channel TOKEN_EXPIRED |
| 4 | `Application request limit reached` | Backoff exponential, respect `x-app-usage` header |
| 17 | `User request limit reached` | Wait, retry sau |
| 100 | `Invalid parameter` | Fix request, đừng retry |

### Read `x-app-usage` header

```ts
const usage = JSON.parse(res.headers.get('x-app-usage') ?? '{}');
// { call_count: 40, total_cputime: 30, total_time: 10 }  — phần trăm
if (usage.call_count > 80) {
  logger.warn('FB app usage high, throttling');
}
```

---

## 3. Instagram (Business/Creator)

| Mục | Chi tiết |
|-----|----------|
| **API** | Instagram Graph API (qua Meta Graph API) |
| **Auth** | Meta OAuth. **Yêu cầu IG Business Account link với Facebook Page** |
| **Scopes** | `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list` |
| **Base URL** | `https://graph.facebook.com/v18.0/{igUserId}` |

### `Channel.metadata` shape

```ts
{
  igUserId: string,
  username: string,
  linkedFacebookPageId: string,   // bắt buộc có
  accountType: 'BUSINESS' | 'CREATOR',
  followersCount: number,
  followsCount: number,
  mediaCount: number,
  profilePictureUrl: string,
}
```

### Đăng bài — quy trình 2 bước

```ts
// Bước 1: Create media container (upload + metadata)
// POST /{igUserId}/media
const container = await post(`/${igUserId}/media`, {
  image_url: mediaUrl,
  caption: post.content?.slice(0, 2200),       // ≤ 2200 ký tự
  // Cho REELS/VIDEO:
  // media_type: 'REELS', video_url: ..., cover_url: ..., share_to_feed: true
});
// Trả { id: containerId }

// LƯU containerId vào PostTarget.platformOverrides
await prisma.post.update({
  where: { id: post.id },
  data: { metadata: { ...post.metadata, containerId: container.id } },
});

// Bước 2: Publish container
// POST /{igUserId}/media_publish
const published = await post(`/${igUserId}/media_publish`, {
  creation_id: container.id,
});
// Trả { id: mediaId }
```

### Media types

| Type | Giới hạn |
|------|----------|
| `IMAGE` | JPEG/PNG, aspect 4:5 → 1.91:1 |
| `VIDEO` | MP4/MOV, ≤ 60s (feed) hoặc ≤ 15min (IGTV) |
| `REELS` | MP4/MOV, ≤ 90s, aspect 9:16 |
| `CAROUSEL` | 2–10 items, mix image + video |

### Carousel — 2 bước nhân N

```ts
// 1. Tạo N child containers (is_carousel_item=true)
const children = await Promise.all(mediaUrls.map((url) =>
  post(`/${igUserId}/media`, { image_url: url, is_carousel_item: true }),
));
// 2. Tạo parent carousel container
const parent = await post(`/${igUserId}/media`, {
  media_type: 'CAROUSEL',
  children: children.map((c) => c.id).join(','),
  caption,
});
// 3. Publish parent
```

### Lỗi thường gặp

| Code | Ý nghĩa |
|------|---------|
| 9004 | Media processing chưa xong — wait 5–30s rồi retry publish |
| 2207003 | Caption quá dài (> 2200) |
| 2207026 | Media không đúng aspect ratio |
| 10 | IG account chưa link FB Page |

---

## 4. X (Twitter)

| Mục | Chi tiết |
|-----|----------|
| **API** | X API v2 |
| **Auth** | OAuth 2.0 + **PKCE** |
| **Scopes** | `tweet.read`, `tweet.write`, `users.read`, `offline.access`, `like.read` |
| **Base URL** | `https://api.x.com/2` (hoặc `api.twitter.com/2`) |
| **Rate limit** | **Rất nghiêm ngặt** — Free tier: 1,500 tweets/tháng. Respect `x-rate-limit-reset` header |

### `Channel.metadata` shape

```ts
{
  userId: string,
  username: string,
  verified: boolean,
  followersCount: number,
  followingCount: number,
  tweetCount: number,
  profileImageUrl: string,
}
```

### Post tweet

```ts
// POST https://api.x.com/2/tweets
{
  text: post.content?.slice(0, 280),        // Free: 280; Premium: 25_000
  media: { media_ids: uploadedMediaIds },   // tối đa 4 ảnh HOẶC 1 video
  reply: { in_reply_to_tweet_id: replyToId },
  quote_tweet_id: quoteId,
  poll: { options: [...], duration_minutes: 1440 },
}
```

### Thread

```ts
async function postThread(texts: string[]) {
  let lastId: string | null = null;
  const ids: string[] = [];
  for (const text of texts) {
    const res = await post('/tweets', {
      text: text.slice(0, 280),
      ...(lastId ? { reply: { in_reply_to_tweet_id: lastId } } : {}),
    });
    lastId = res.data.id;
    ids.push(res.data.id);
  }
  return ids;
}
```

### Upload media (v1.1 — v2 chưa có)

```ts
// POST https://upload.twitter.com/1.1/media/upload.json
// multipart/form-data: command=INIT, APPEND, FINALIZE
```

### Rate limit — respect header

```ts
const reset = Number(res.headers.get('x-rate-limit-reset'));  // Unix seconds
const remaining = Number(res.headers.get('x-rate-limit-remaining'));
if (remaining === 0) {
  const waitMs = reset * 1000 - Date.now();
  throw new WorkerRetryError(`Reset in ${waitMs}ms`, { delay: waitMs });
}
```

---

## 5. Telegram

| Mục | Chi tiết |
|-----|----------|
| **API** | Telegram Bot API |
| **Auth** | **Bot Token** (không phải OAuth). Tạo bot qua @BotFather |
| **Base URL** | `https://api.telegram.org/bot{token}` |
| **Rate limit** | 30 msg/sec overall; 1 msg/sec per chat; 20/min group limit |

### Pre-condition

Bot **phải là admin** của channel/group đích.

### `Channel.metadata` shape

```ts
{
  chatId: number | string,       // số âm cho channel (-100...), dương cho user
  chatType: 'channel' | 'group' | 'supergroup',
  title: string,
  memberCount: number,
  inviteLink: string,
  description: string,
}
```

### Send text

```ts
// POST /bot{token}/sendMessage
{
  chat_id: metadata.chatId,
  text: post.content,              // ≤ 4096 ký tự
  parse_mode: 'HTML' | 'MarkdownV2',
  disable_notification: false,
  protect_content: false,
  reply_markup: {
    inline_keyboard: [[{ text: 'Xem thêm', url: 'https://...' }]],
  },
}
```

### Send media group (multiple photos)

```ts
// POST /bot{token}/sendMediaGroup
{
  chat_id,
  media: [
    { type: 'photo', media: url1, caption: post.content },  // caption chỉ trên item đầu
    { type: 'photo', media: url2 },
  ],
}
```

### MarkdownV2 escape

```ts
const ESCAPE_CHARS = /[_*[\]()~`>#+\-=|{}.!]/g;
function escapeMdV2(text: string): string {
  return text.replace(ESCAPE_CHARS, (m) => `\\${m}`);
}
```

Text > 4096 phải chia nhiều message (chia theo đoạn, không giữa từ).

### Lỗi thường gặp

| Code | Ý nghĩa |
|------|---------|
| 400 `chat not found` | Bot bị kick hoặc chatId sai |
| 400 `can't parse entities` | Markdown escape thiếu |
| 403 `bot was blocked by user` | User chặn bot (với chat 1-1) |
| 429 `Too Many Requests` | Respect `parameters.retry_after` (giây) |

---

## 6. WhatsApp Business

| Mục | Chi tiết |
|-----|----------|
| **API** | WhatsApp Cloud API (Meta) |
| **Auth** | `phoneNumberId` + System User Token |
| **Base URL** | `https://graph.facebook.com/v18.0/{phoneNumberId}` |
| **Rate limit** | Theo tier business (1k/24h/phone → up to 100k/day) |

### ⚠️ Cửa sổ 24 giờ (quan trọng!)

- Trong 24h kể từ tin nhắn cuối của **user** gửi đến → gửi **free-form** message OK.
- Ngoài 24h → **chỉ được gửi template đã được Meta duyệt**. Không dùng cho broadcast marketing nếu không đúng category.

### `Channel.metadata` shape

```ts
{
  phoneNumberId: string,
  wabaId: string,
  displayPhoneNumber: string,     // '+84901234567'
  verifiedName: string,
  qualityRating: 'GREEN' | 'YELLOW' | 'RED',
}
```

### Send text (trong cửa sổ 24h)

```ts
// POST /{phoneNumberId}/messages
{
  messaging_product: 'whatsapp',
  to: '84901234567',           // E.164 format KHÔNG có dấu +
  type: 'text',
  text: { body: post.content },
}
```

### Send template (ngoài cửa sổ 24h)

```ts
{
  messaging_product: 'whatsapp',
  to: '84901234567',
  type: 'template',
  template: {
    name: 'order_confirmation',
    language: { code: 'vi' },
    components: [
      {
        type: 'header',
        parameters: [{ type: 'image', image: { link: coverUrl } }],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: customerName },
          { type: 'text', text: orderId },
        ],
      },
    ],
  },
}
```

### Send media

```ts
{
  messaging_product: 'whatsapp',
  to,
  type: 'image',   // image | video | document | audio
  image: { link: url, caption: '...' },
}
```

### Webhook — nhận tin nhắn từ user

```ts
// Verify challenge (GET /webhook)
if (mode === 'subscribe' && token === VERIFY_TOKEN) res.send(challenge);

// Receive message (POST /webhook)
{
  entry: [{
    changes: [{
      value: {
        messages: [{
          from: '84901...',
          id: 'wamid...',
          timestamp: '1234567890',
          type: 'text',
          text: { body: 'Hello' },
        }],
      },
    }],
  }],
}
```

---

## 7. Chung — abstract Integration interface

Khi có nhiều platform, nên abstract để queue worker call chung:

```ts
// apps/api/src/integrations/base.ts
export interface PlatformIntegration {
  publish(channel: Channel, post: Post): Promise<{ externalId: string; url?: string }>;
  fetchAnalytics(channel: Channel, date: Date): Promise<AnalyticsSnapshot>;
  refreshToken(channel: Channel): Promise<{ accessToken: string; expiresAt: Date }>;
}

// apps/api/src/integrations/index.ts
import { YouTubeIntegration } from './youtube';
import { FacebookIntegration } from './facebook';
// ...

export const INTEGRATIONS: Record<Platform, PlatformIntegration> = {
  YOUTUBE: new YouTubeIntegration(),
  FACEBOOK: new FacebookIntegration(),
  INSTAGRAM: new InstagramIntegration(),
  X: new XIntegration(),
  TELEGRAM: new TelegramIntegration(),
  WHATSAPP: new WhatsAppIntegration(),
};
```

Worker:
```ts
async function processPublishJob(job: Job<{ postId: string }>) {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: job.data.postId }, include: { channel: true } });
  const integration = INTEGRATIONS[post.platform];
  const { externalId } = await integration.publish(post.channel, post);
  await prisma.post.update({
    where: { id: post.id },
    data: { metadata: { ...post.metadata, externalId }, publishedAt: new Date() },
  });
}
```

---

## 8. Test account checklist

Khi setup kênh test, tối thiểu có:

- [ ] YouTube: test channel (không public), quota dev 10k/day
- [ ] Facebook: test page + test app (Graph API Explorer)
- [ ] Instagram: IG Business Account linked với FB Page test
- [ ] X: developer account, Basic tier ($100/mo) nếu cần post
- [ ] Telegram: bot từ @BotFather + test channel cho bot làm admin
- [ ] WhatsApp: test number provisioned trong Meta Business Suite

---

## 9. Debug checklist khi publish fail

1. `Channel.status` = ACTIVE? Nếu TOKEN_EXPIRED → refresh token trước.
2. `tokenExpiresAt` còn hạn? Cron `0 */6 * * *` check kênh sắp expire.
3. Đã check `externalPostId` chưa? (idempotency)
4. Rate limit header: `x-app-usage`, `x-rate-limit-remaining`, `Retry-After`.
5. Log request/response (mask token!) để trace.
6. Check platform status page (FB/IG Graph API có downtime).

---

## 10. Token lifetime matrix (Phase 6 findings)

Bảng tổng hợp từ thực tế build 5 service. **Pre-emptive refresh buffer** = thời điểm sweep cron nên kích refresh trước khi expire.

| Platform | Access token | Refresh token | Pre-emptive buffer | Notes |
|----------|--------------|---------------|--------------------|-------|
| **YouTube** | 1 giờ | 6 tháng inactivity | 5 phút | `prompt=consent` lúc auth để chắc có refresh_token. Google **không luôn trả** refresh_token mới khi exchange — giữ cũ nếu vắng |
| **Facebook Page** | ~60 ngày OR vĩnh viễn | ❌ không có | 7 ngày | Page Access Token long-lived (lấy từ `/me/accounts` qua user long-lived token) **không expire** trong thực tế (Meta docs) — trừ khi user đổi password / unlink. `tokenExpiresAt` thường null |
| **Facebook User** | 60 ngày | ❌ không có | 7 ngày | Long-lived user token hỗ trợ extend qua `grant_type=fb_exchange_token` (nếu còn ≥1 ngày) |
| **Instagram Business** | 60 ngày (User token) | ❌ không có | 7 ngày | IG ops dùng User access token, không phải Page token. Refresh = exchange long-lived khi còn hạn |
| **X (Twitter)** | 2 giờ | ✅ vĩnh viễn (với `offline.access` scope) | 5 phút | Standard OAuth 2.0 refresh grant. PKCE bắt buộc |
| **Telegram Bot** | ✅ vĩnh viễn | — | — | Chỉ revoke qua @BotFather. Không có expiry. Không có refresh |
| **WhatsApp Cloud** | ✅ vĩnh viễn (System User token) | — | — | Phải tạo System User trong Business Manager. Không phải User token |

### Pre-emptive refresh pattern (đã implement trong [base-platform.service.ts](../../apps/api/src/modules/platforms/base-platform.service.ts))

```ts
// withTokenRefresh — pseudo
async function withTokenRefresh(channel, fn) {
  let token = await getValidAccessToken(channel);
  // ↑ Nếu tokenExpiresAt < now + buffer → refresh trước
  try {
    return await fn(token);
  } catch (e) {
    if (e instanceof TokenExpiredError && channel.refreshToken) {
      token = await refreshAndStore(channel);
      return fn(token); // retry 1 lần
    }
    throw e;
  }
}
```

### Refresh fail → mark TOKEN_EXPIRED

Khi refresh token bị revoked (user đổi password, app bị un-authorize, refresh token hết 6 tháng):

```ts
await prisma.channel.update({
  where: { id: channel.id },
  data: { status: 'TOKEN_EXPIRED' },
});
// → Bell/alerts hiển thị, user phải reconnect qua /channels/connect
```

---

## 11. Rate limit thực tế (Phase 6 measurements)

### YouTube — quota units (10,000/ngày default)

| API call | Cost | Ghi chú |
|----------|------|---------|
| `channels.list?mine=true` | 1 | Cheapest — dùng cho verify token |
| `playlistItems.list` | 1 | Lấy uploads playlist |
| `videos.list?id=...` | 1 (per part requested) | Batch 50 IDs/call → 1 unit cho cả batch |
| `videos.update` | 50 | Schedule, edit metadata |
| `videos.insert` (upload) | 1,600 | Upload video — heavy |
| `search.list` | 100 | Đắt, tránh dùng nếu có thể |
| `youtubeAnalytics.reports` | 1 | Mỗi metric query 1 unit |

**Kinh nghiệm**: với 1 channel sync analytics + videos hàng giờ → ~50-100 units/ngày. Upload nhiều video mới hết quota nhanh. Cache `uploadsPlaylistId` trong `Channel.metadata` để khỏi gọi `channels.list` mỗi sync.

**Reset**: 0:00 PT (= 15:00 VN). Hết quota → `403 quotaExceeded` cho đến reset.

### Facebook — Business Use Case (BUC) limits

| Limit | Value | Window |
|-------|-------|--------|
| User-level call rate | 200 calls/giờ/user | sliding 1h |
| App-level rate | 200 × số DAU app | 1h |
| Insights | unlimited (nhưng có throttle) | — |
| Page post throughput | ~25 post/giờ/Page (soft) | 1h |
| Scheduled time range | now+10min đến now+6 tháng | — |

Track qua header `x-app-usage` (JSON `{ call_count, total_cputime, total_time }` — phần trăm 0-100). Đã implement trong [meta-api-client.ts](../../apps/api/src/modules/platforms/meta-api-client.ts) — log warn khi `call_count > 90`.

```ts
const usage = res.headers.get('x-app-usage');
if (usage) {
  const parsed = JSON.parse(usage);
  if (parsed.call_count > 90) logger.warn(`App usage cao: ${usage}`);
}
```

### Instagram — Container processing time

- Image container: < 1 giây
- Video container: 30s - 2 phút (poll `status_code` đến `FINISHED`)
- Reels: tương tự video, có thể chậm hơn (1-3 phút)
- Carousel: từng child container ~1s + parent assembly ~2s
- Container TTL: **24 giờ** — phải `media_publish` trong 24h hoặc bị `EXPIRED`

### X — rất hạn chế ở Free tier

| Endpoint | Free tier limit |
|----------|-----------------|
| POST tweets | 17/24h/user, 1500/tháng/app |
| GET tweets | 1 req/15min/user |
| User lookup | 25 req/24h/user |

**Basic tier ($100/mo)**: 100 tweets/24h, 50k/tháng. Production app phải Basic+.

Headers track:
- `x-rate-limit-remaining` — calls còn lại trong window
- `x-rate-limit-reset` — Unix sec khi reset
- `x-rate-limit-limit` — total calls window

### Telegram

- Global: 30 messages/sec across all chats (bot)
- Per chat: 1 message/sec để user thường, 20 messages/phút trong group
- Channel post: 30/giây với rate-limit shaped
- File upload: 50MB local URL, 20MB remote URL
- Error 429 trả `parameters.retry_after` (giây) — base service auto-honor qua retry helper

### WhatsApp Cloud — tier-based daily

| Tier | Phone numbers | Conversations/24h | Note |
|------|---------------|-------------------|------|
| Tier 1 | 1 | 1,000 | Default cho phone mới approve |
| Tier 2 | 1 | 10,000 | Tự upgrade sau 7 ngày + quality rating GREEN |
| Tier 3 | 1 | 100,000 | |
| Tier 4 | 1 | unlimited | Cần direct support Meta |

Conversation = 24h-window từ tin user đầu tiên. Template messages không tính vào conversation cap nhưng tính daily message rate.

---

## 12. Scope checklist — đầy đủ per platform

### YouTube (Google OAuth 2.0)

| Scope | Bắt buộc cho | Ghi chú |
|-------|--------------|---------|
| `https://www.googleapis.com/auth/youtube.readonly` | List channels, videos, comments | Always |
| `https://www.googleapis.com/auth/youtube.upload` | Upload video | Cho upload feature |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | Analytics views/watch time | **Tách riêng** với youtube scope! |
| `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` | Revenue metrics | Cần verify domain trong Google Cloud Console |
| `https://www.googleapis.com/auth/youtubepartner-channel-audit` | Monetization audit (strikes, eligibility) | **Limited access** — Google review case-by-case |

Code: [adapters.ts §1 YouTube](../../apps/web/src/lib/platform-oauth/adapters.ts).

### Facebook + Instagram (Meta OAuth)

| Scope | Bắt buộc cho |
|-------|--------------|
| `pages_show_list` | List Pages user quản lý — bắt buộc cho cả FB và IG |
| `pages_read_engagement` | Đọc post engagement, comments |
| `pages_manage_posts` | Tạo/sửa/xoá Page posts |
| `pages_manage_engagement` | Reply comments (Phase 1) |
| `read_insights` | Page insights (impressions, reach, fans) |
| `business_management` | (Optional) Quản lý qua Business Manager |
| `instagram_basic` | IG account info, media list |
| `instagram_content_publish` | Đăng IG posts/reels |
| `instagram_manage_insights` | Per-media insights (engagement, reach) |
| `instagram_manage_comments` | Reply IG comments (Phase 1) |

⚠ **Meta App Review** required cho production: tất cả scope `pages_*` + `instagram_*` đều cần submit demo video + use case justification → Meta duyệt 3-7 ngày.

### X (Twitter OAuth 2.0 + PKCE)

| Scope | Bắt buộc cho |
|-------|--------------|
| `tweet.read` | List tweets |
| `tweet.write` | Post tweets |
| `users.read` | Profile info |
| `offline.access` | Refresh token cấp permanent |
| `like.read` | Read likes (Phase 1) |
| `media.write` | (Optional 2024+) OAuth 2.0 media upload — fallback OAuth 1.0a nếu chưa whitelist |

### Telegram

**Không có scopes** — bot token cấp quyền theo cấu hình ở @BotFather:
- `Privacy Mode` (default ON): bot chỉ thấy tin nhắn nhắc tên hoặc reply. Tắt nếu cần đọc tất cả messages.
- `Allow Groups`: cho phép add bot vào group
- `Inline Mode`: bot có thể trả lời inline queries

Set qua `/setprivacy`, `/setjoingroups`, `/setinline` ở @BotFather chat.

### WhatsApp Cloud API

**System User token** với 2 permissions:
- `whatsapp_business_management` — quản lý phone numbers, templates
- `whatsapp_business_messaging` — gửi messages

System User tạo trong Business Manager → Settings → Users → System Users → Add → Generate token (chọn 2 permissions).

---

## 13. Common errors — fix matrix

| Platform | Code | Error | Fix |
|----------|------|-------|-----|
| YouTube | 401 | Invalid Credentials | Refresh token + retry. Refresh fail → mark TOKEN_EXPIRED, user reconnect |
| YouTube | 403 `quotaExceeded` | Hết quota ngày | Đợi reset 0:00 PT (15:00 VN). Cache aggressive, reduce sync frequency |
| YouTube | 403 `forbidden` | Token thiếu scope | Re-auth với scope đầy đủ |
| YouTube | 308 (upload) | Resume needed | Phase 1 implement chunked PUT với Content-Range header |
| YouTube | `uploadStatus=processing` | Video chưa ready | Poll lại sau 5min — KHÔNG thực sự lỗi |
| Facebook | 190 / subcode 460 | Password changed | Mark TOKEN_EXPIRED, user reconnect |
| Facebook | 190 / subcode 463 | Token expired | Try `fb_exchange_token` refresh; fail → reconnect |
| Facebook | 100 | Invalid parameter | Fix request, **KHÔNG** retry |
| Facebook | 4 / 17 | App / User rate limit | Honor `Retry-After`, throttle |
| Facebook | 200 | Permission denied | User revoke scope — re-auth với scope đầy đủ |
| Facebook | 368 | Page tạm khoá | Manual review trên Business Manager |
| Instagram | 9004 | Media processing chưa xong | Wait 5-30s, retry `media_publish` |
| Instagram | Container `EXPIRED` | Quá 24h từ create | Tạo container mới |
| Instagram | Container `ERROR` | Format/size sai | Check file format (mp4 với h.264, ratio đúng) |
| Instagram | 2207003 | Caption > 2200 chars | Truncate ở adapter |
| Instagram | 2207026 | Aspect ratio sai | IMAGE: 4:5 → 1.91:1; REELS: 9:16 |
| Instagram | 10 | IG account chưa link FB Page | Link trong app FB → Settings → Linked Accounts |
| X | 89 | Invalid/expired token | Refresh + retry |
| X | 88 | Rate limit | Read `x-rate-limit-reset`, wait |
| X | 187 | Duplicate status | Tweet trùng nội dung — thêm timestamp hoặc skip |
| X | 220 / 215 | Bad authentication | OAuth flow sai, kiểm tra PKCE verifier |
| Telegram | 401 | Bot token sai | Check token valid via `/getMe` |
| Telegram | 400 `chat not found` | Bot bị kick / chatId sai | Re-add bot, update `metadata.chatId` |
| Telegram | 400 `can't parse entities` | MarkdownV2 escape thiếu | Switch parse_mode=HTML hoặc escape `_*[]()~` |
| Telegram | 403 `bot was blocked` | User block bot (chat 1-1) | Bỏ qua, không retry |
| Telegram | 429 | Rate limit | Honor `parameters.retry_after` |
| WhatsApp | 100 | Recipient not on WhatsApp | Verify phone E.164 đúng country code |
| WhatsApp | 131026 | Outside 24h window | Dùng template message thay vì free-form text |
| WhatsApp | 131047 | Re-engagement window expired | Send template trước khi gửi free-form |
| WhatsApp | 131051 | Unsupported message type | Check type là `text\|image\|video\|template` |

### Retry policy decision tree

```
Error
  ├─ 401 / token expired → refresh + retry 1 lần (KHÔNG count vào retry attempts)
  ├─ 429 / rate limit    → respect Retry-After, retry với delay
  ├─ 5xx                 → exponential backoff retry (3 lần, 1s/2s/4s)
  ├─ 4xx (other)         → KHÔNG retry, log + throw
  └─ Network (ECONNRESET, ETIMEDOUT) → retry với backoff
```

Đã implement trong [BasePlatformService.retry()](../../apps/api/src/modules/platforms/base-platform.service.ts).

---

## 14. Sandbox / test mode — không lỡ post lên prod

### YouTube

- **Không có sandbox API** — gọi thẳng prod endpoints
- Tạo **test channel** riêng (không public hoặc unlisted)
- Upload video với `privacyStatus: 'unlisted'` → visible chỉ với link
- Quota dev mặc định 10k/ngày — đủ test
- Để xin tăng quota production: https://support.google.com/youtube/contact/yt_api_form

### Facebook + Instagram

- **Test app** trong Meta Developer: tạo app riêng tag "Test" → có Test Users + Test Pages
- Test users tạo qua Roles → Test Users → Add → Generate. Login bằng test user → app chỉ visible cho họ.
- Test Pages: tạo từ test user → tự động trong sandbox
- IG: phải link test FB Page với IG Business Account (cần real IG creator account, switch sang Business)
- Production posts visible với mọi audience theo Page settings
- **App Review** required khi go live — submit case + demo video

### X (Twitter)

- **Free tier dev account** đủ test 17 tweets/day
- Tạo X account riêng (set Protected Tweets → chỉ followers thấy → safe để test)
- App register tại https://developer.x.com → Project → Add App → OAuth 2.0 settings
- Set callback URI = `http://localhost:3000/api/v1/platforms/x/callback` cho dev
- Production: cần Basic tier ($100/mo) để post tweets meaningful

### Telegram

- Tạo **test bot** mới qua @BotFather:
  ```
  /newbot → "MyTestBot" → @myteststaging_bot → token
  ```
- Tạo **test channel** riêng (private, chỉ bạn) → add bot làm admin
- Mọi message bot gửi vào channel test này = visible chỉ bạn
- Production bot riêng (different token) → real channels

### WhatsApp Cloud API

- Meta cấp **Test Number** miễn phí khi tạo WhatsApp Business app
- Test number gửi được **5 recipients tối đa** — phải pre-verify từng recipient (add vào `Allowed phone numbers` trong app)
- Templates: tạo + submit, Meta duyệt ~24h (free, unlimited templates)
- Production: cần associate phone number thật + verify business

### Universal trick: env var `PLATFORM_DRY_RUN`

```ts
if (process.env.PLATFORM_DRY_RUN === '1') {
  this.logger.log(`[DRY RUN] Would publish to ${platform}: ${title}`);
  return { externalPostId: 'dry-run-fake-id', status: 'PUBLISHED' };
}
```

Dev có thể set `PLATFORM_DRY_RUN=1` trong `.env.local` để test toàn bộ flow mà không thật sự call API. Phase 1 nên thêm flag này vào tất cả service publish methods.

---

## 15. Webhook setup — real-time updates

### Facebook + Instagram (cùng cơ chế Meta)

**Setup webhook subscription**:
1. App Settings → Webhooks → Add Subscription
2. Callback URL: `https://yourapp.com/api/v1/webhooks/meta` (HTTPS bắt buộc)
3. Verify Token: random string lưu env `META_WEBHOOK_VERIFY_TOKEN`
4. Subscribe fields: `feed`, `mention`, `comments`, `messages` (FB Page); `mentions`, `messages`, `story_insights` (IG)

**Verify endpoint** (GET request từ Meta):
```ts
// GET /api/v1/webhooks/meta
export const GET = (req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
};
```

**Receive endpoint** (POST request):
```ts
// POST /api/v1/webhooks/meta
import crypto from 'node:crypto';

export const POST = async (req) => {
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const body = await req.text(); // RAW body — không parse JSON trước

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', process.env.META_APP_SECRET!)
      .update(body)
      .digest('hex');
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return new Response('Invalid signature', { status: 403 });
  }

  const data = JSON.parse(body);
  // Enqueue BullMQ job — reply nhanh < 5s
  await webhookQueue.add('meta', data);
  return new Response('OK', { status: 200 });
};
```

**Lưu ý quan trọng**: Meta retry webhook nếu không nhận 200 trong 20s. Phải reply nhanh + xử lý nặng trong queue worker.

**Page subscription** (sau verify webhook URL, Page phải subscribe app):
```ts
// POST /{pageId}/subscribed_apps?subscribed_fields=feed,mention,comments
//   với Page Access Token
```

### YouTube — PubSubHubbub (PSHB)

Cho real-time video published notification:

1. Subscribe topic: `https://www.youtube.com/xml/feeds/videos.xml?channel_id={channelId}`
2. Hub: `https://pubsubhubbub.appspot.com/subscribe`
3. POST với:
   ```
   hub.mode=subscribe
   hub.topic=https://www.youtube.com/xml/feeds/videos.xml?channel_id=...
   hub.callback=https://yourapp.com/api/v1/webhooks/youtube
   hub.lease_seconds=864000  // 10 ngày
   ```
4. Hub gửi GET verify với `hub.challenge` — response thẳng challenge

Nội dung PSHB là Atom XML — parse và dispatch.

### Telegram — `setWebhook` (alternative to long polling)

```ts
// Set webhook URL
await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://yourapp.com/api/v1/webhooks/telegram',
    secret_token: 'random-string', // gửi trong header X-Telegram-Bot-Api-Secret-Token
  }),
});
```

Webhook nhận POST với `Update` JSON. Verify qua secret_token header.

### X (Twitter) — Account Activity API

- **Paid only** (Pro tier $5,000/mo+)
- Webhook subscribe via API endpoint `account_activity/all/{env_name}/webhooks`
- Sự kiện: tweet_create_events, follow_events, direct_message_events...
- Verify CRC challenge khi webhook setup

Phase 0 không khả thi — fallback poll qua `syncTweetMetrics` mỗi giờ.

### WhatsApp — same Meta webhook

Cùng cơ chế FB/IG nhưng subscribe ở WhatsApp Business app:
- Fields: `messages` (incoming user messages), `message_status` (sent/delivered/read receipts)
- Same verify token + signature pattern

### Webhook security checklist

- [x] Verify signature TRƯỚC khi parse body
- [x] Constant-time compare (`crypto.timingSafeEqual`)
- [x] HTTPS only (Meta + Telegram bắt buộc)
- [x] Reply 200 trong < 5s (push heavy work vào queue)
- [x] Idempotency: log `event_id` đã xử lý trong Redis 24h, skip duplicates
- [x] Whitelist source IP nếu platform expose (FB/IG có range IP cố định)
- [x] Don't log raw payload với PII / tokens

---

## 16. Phase 6 lessons learned — gotchas đã gặp thật

1. **YouTube `prompt=consent` bắt buộc** — nếu không, refresh_token có thể không được trả về (Google chỉ trả lần đầu user authorize). Mọi connect flow phải có `prompt=consent` cho an toàn.

2. **Facebook `/me/accounts` có thể trả 0 pages** — nếu user mới tạo Pages sau khi authorize app. Cần re-auth để app refresh permissions, hoặc dùng `granular_scopes` với re-prompt.

3. **Instagram cần FB Page link** — IG Business Account phải link tới 1 FB Page **trước khi** user authorize. Nếu chưa link → query `/me/accounts?fields=...,instagram_business_account` trả empty → service throw "không tìm thấy IG account". UI cần hướng dẫn link IG-FB trong app FB.

4. **X `Authorization: Basic`** cho refresh_token — KHÔNG phải Bearer. Format: `Basic base64(client_id:client_secret)`. Sai cái này → "invalid_client" error mãi.

5. **Telegram MarkdownV2 escape**: 18 ký tự đặc biệt (`_*[]()~\`>#+-=|{}.!`) phải escape với `\` trước. Phase 0 service mặc định `parse_mode=HTML` để né — HTML cho phép `<b>`, `<i>`, `<a href>` mà không cần escape phức tạp.

6. **WhatsApp 24h window** — sai lầm phổ biến nhất. Test text message bên ngoài window → 131047 error. Production phải route qua `sendTemplate` cho first-contact, sau đó user reply mở window 24h cho text.

7. **IG Container TTL 24h** — nếu queue worker chậm xử lý (vd backed up), container có thể expire trước khi publish. Phase 1 nên check `status_code` ngay trước `media_publish` và rebuild container nếu cần.

8. **Facebook Pages bulk operations** không atomic — nếu post 5 photos rồi feed post fail, 5 photos đã upload `published=false` ở orphan state. Phase 1 cần cleanup job xoá orphans sau N giờ.

9. **YouTube quota đếm theo PROJECT, không theo channel** — 1 Google Cloud project = 10k units cho TẤT CẢ channels app quản lý. Nếu manage 50 channels, mỗi channel sync 1 lần/giờ = 50 units/giờ × 24h = 1,200 units/ngày — vẫn OK, nhưng upload 7 video/ngày là hết quota.

10. **PKCE verifier KHÔNG được persist trong URL state** — phải HttpOnly cookie. Đã implement đúng trong [state.ts](../../apps/web/src/lib/platform-oauth/state.ts) — verifier nằm trong signed cookie, không leak qua URL.

11. **Encryption key rotation phá tất cả token** — nếu đổi `ENCRYPTION_KEY` env, mọi `accessToken` cũ không decrypt được. Phase 1 cần migration script: decrypt với key cũ → encrypt với key mới → update DB.

12. **Telegram chatId âm cho channels** — `-100xxxxxxxxxx` format. Khi user paste chatId thiếu dấu `-100`, getChat fail. Service nên validate và prepend `-100` nếu thiếu.
