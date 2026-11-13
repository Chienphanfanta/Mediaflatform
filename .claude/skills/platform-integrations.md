# Platform Integrations — read-only cheat sheet (YouTube, Facebook, TikTok)

> V2 chỉ hỗ trợ **3 nền tảng: YouTube, Facebook, TikTok**. Mọi tương tác là **GET metrics** —
> KHÔNG đăng, sửa, xoá nội dung. Không xin OAuth scope có quyền ghi.
>
> Vị trí code:
> - OAuth connect/callback (web): `apps/web/src/lib/platform-oauth/adapters.ts`
> - Sync metrics (api): `apps/api/src/modules/platforms/{youtube,meta,tiktok}.service.ts`
> - Dispatch theo platform: `apps/api/src/modules/queue/workers/analytics-sync.worker.ts`

---

## 0. Nguyên tắc chung

### Token
- Lưu ở `Channel.accessToken` / `Channel.refreshToken`, **mã hoá AES-256-GCM** qua
  `encryptToken()` / `decryptToken()` (`apps/api/src/lib/token-encryption.ts`).
- KHÔNG log plaintext token — dùng `maskToken()`.
- Pre-emptive refresh khi `tokenExpiresAt` sắp tới; refresh fail → `status = INACTIVE`,
  `lastSyncError = 'TOKEN_EXPIRED'` → user phải kết nối lại.

### Sync
- Worker `analytics-sync` chạy mỗi giờ, mỗi channel bị rate-limit 1 lần/giờ qua Redis
  (`redis.checkRateLimit(key, 3600)`).
- Ghi vào `Analytics` theo `@@unique([channelId, date])` → luôn `upsert`, chạy lại an toàn.
- Lỗi 429 / 5xx → retry exponential backoff; lỗi 4xx khác → không retry.

### Thêm platform mới (checklist)
1. Thêm value vào `enum Platform` (`packages/db/prisma/schema.prisma`) + `prisma generate`.
2. `apps/web/src/lib/platform.ts` — `PLATFORMS`, `PLATFORM_LABEL`, `PLATFORM_HEX`, `PLATFORM_BG`, `PLATFORM_DOT`.
3. `apps/web/src/lib/schemas/channels.ts` — `PLATFORM_VALUES`.
4. OAuth adapter + đăng ký trong `apps/web/src/lib/platform-oauth/index.ts`.
5. Service sync trong `apps/api/src/modules/platforms/` + case trong `analytics-sync.worker.ts`.
6. `ViewsByDay` (`apps/web/src/lib/types/dashboard.ts`) + `dashboard/overview/route.ts`.
7. Env vars trong `.env.example`.
TypeScript `Record<Platform, …>` sẽ báo lỗi ở mọi chỗ còn thiếu — chạy `tsc --noEmit` để tìm.

---

## 1. YouTube

| Mục | Chi tiết |
|-----|----------|
| **API** | YouTube Data API v3 + YouTube Analytics API v2 |
| **Auth** | Google OAuth 2.0 (`access_type=offline`, `prompt=consent` để luôn có refresh_token) |
| **Scopes** | `youtube.readonly`, `yt-analytics.readonly` |
| **Token** | access_token ~1h, refresh_token dài hạn |
| **Quota** | 10,000 units/ngày/project. channels.list = 1, analytics query ≈ 1 |
| **Env** | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI` |

- Analytics API có độ trễ ~1 ngày → service fetch lookback 7 ngày để lấp ngày thiếu.
- Quota được theo dõi trong `YouTubeQuotaService` (reserve trước khi gọi).
- `quotaExceeded` (403) → dừng sync, quota reset lúc 00:00 giờ Pacific (~14–15h VN).

`Channel.metadata`: `{ channelId, channelHandle, subscriberCount, viewCount, videoCount, country, defaultLanguage, thumbnailUrl }`

---

## 2. Facebook (Page)

| Mục | Chi tiết |
|-----|----------|
| **API** | Graph API v18.0+ (Page Insights) |
| **Auth** | Meta OAuth → user token → long-lived (60 ngày) → **Page Access Token** |
| **Scopes** | `pages_show_list`, `pages_read_engagement`, `read_insights` |
| **Rate limit** | 200 calls/giờ/user + Business Use Case limits theo Page |
| **Env** | `META_APP_ID`, `META_APP_SECRET`, `FACEBOOK_REDIRECT_URI` |

- Page token long-lived thường không expire; bị thu hồi khi user đổi mật khẩu/quyền.
- Không có refresh_token chuẩn — chỉ exchange long-lived → long-lived khi còn hạn.
- Theo dõi header `x-app-usage` (phần trăm); > 80% → giảm tần suất.
- Hiện tại connect tự chọn Page đầu tiên trong `/me/accounts`.

| Code | Ý nghĩa | Xử lý |
|------|---------|-------|
| 190 | Token invalid | Mark TOKEN_EXPIRED, yêu cầu kết nối lại |
| 4 / 17 | Rate limit app / user | Backoff, retry sau |
| 100 | Invalid parameter | Sửa request, không retry |

`Channel.metadata`: `{ pageId, pageName, category, fanCount, verificationStatus }`

---

## 3. TikTok

| Mục | Chi tiết |
|-----|----------|
| **API** | TikTok API v2 — Login Kit + Display API (`https://open.tiktokapis.com/v2`) |
| **Auth** | OAuth 2.0: `https://www.tiktok.com/v2/auth/authorize/` (dùng `client_key`, scope phân cách bằng dấu phẩy) |
| **Token endpoint** | `POST /v2/oauth/token/` (form-urlencoded: `client_key`, `client_secret`, `grant_type`, …) |
| **Scopes** | `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list` |
| **Token** | access_token **24h**, refresh_token **365 ngày** → luôn phải refresh |
| **Env** | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` |

Endpoints dùng (đều chỉ đọc):
- `GET /v2/user/info/?fields=open_id,display_name,username,avatar_url,follower_count,following_count,likes_count,video_count`
- `POST /v2/video/list/?fields=id,view_count,like_count,comment_count,share_count` body `{ max_count: 20, cursor }`

Response luôn dạng `{ data, error: { code, message, log_id } }` — `error.code === 'ok'` là thành công;
`access_token_invalid` → refresh rồi thử lại 1 lần.

**TikTok không có insights theo ngày.** `TikTokService.syncAccountStats()` ghi 1 snapshot/ngày:

| Cột `Analytics` | Cách tính |
|---|---|
| `subscribers` | `follower_count` hiện tại |
| `subscriberDelta` | so với snapshot gần nhất trước hôm nay |
| `views` | tổng view của ≤100 video gần nhất, trừ giá trị đó ở snapshot trước (≥ 0) |
| `engagementRate` | (like + comment + share) / view của các video gần nhất × 100 |
| `raw` | `followerCount, likesCount, videoCount, recentVideoViews, …` |

Lưu ý:
- App phải qua **TikTok app review** mới dùng được `user.info.stats` và `video.list` trên tài khoản thật;
  trước đó chỉ test được với tài khoản sandbox được thêm vào app.
- `video.list` lỗi (chưa cấp scope) → vẫn ghi follower, views = 0.
- `Channel.accountId` = `open_id` (định danh theo app, không phải username).

`Channel.metadata`: `{ openId, username, displayName, avatarUrl, profileUrl, followersCount, followingCount, likesCount, videoCount }`

---

## 4. Debug checklist khi sync fail

1. `SyncLog` của channel (`/api/v1/channels/:id/sync-logs`) — status + error message.
2. `Channel.status` / `lastSyncError` — `TOKEN_EXPIRED` → kết nối lại.
3. Env OAuth đã điền đủ? (`Missing env: …` trong log)
4. Redis rate-limit key còn TTL? (`yt:sync-stats:*`, `meta:fb-sync:*`, `tiktok:sync:*`)
5. YouTube: quota ngày còn không? (`/settings/queues`)
