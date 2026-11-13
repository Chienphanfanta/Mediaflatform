# Đăng bài qua browser extension — kiến trúc & quy tắc

> Đọc khi sửa module đăng bài (web `/posts`, `apps/extension`, `apps/api/src/modules/posts`).

## Luồng dữ liệu

```
Web /posts/new ──POST /api/v1/media──▶ presigned PUT ──▶ MinIO
      │
      └─POST /api/v1/posts──▶ Post (SCHEDULED) + PostTarget (PENDING) × mỗi kênh
                                   │
Extension (mỗi phút)               ▼
  GET  /ext/me      heartbeat → BrowserDevice.lastSeenAt
  GET  /ext/queue   target PENDING, đến giờ, kênh mà device.user là owner (ChannelOwnership)
  POST /ext/targets/:id/claim   PENDING → PUBLISHING (atomic updateMany, chống đăng trùng)
  mở cửa sổ openUrl → inject content/runner.js → chạy flow steps
  POST /ext/targets/:id/result  → PUBLISHED | FAILED | PENDING (retryable, < MAX_ATTEMPTS)
                                   │
api cron mỗi phút (PostReminderService)
  - "/start <mã>" từ Telegram bot → User.telegramChatId
  - target đến giờ chưa nhắc → Telegram/Zalo cho owner (PRIMARY ưu tiên), set remindedAt
  - target FAILED chưa báo → nhắn người tạo bài, set failureNotifiedAt
```

## Trạng thái

- `PostTarget`: PENDING → PUBLISHING → PUBLISHED / FAILED; CANCELLED khi huỷ/xoá.
- `Post.status` luôn tính lại từ targets bằng `refreshPostStatus()` (lib/posts/access.ts) —
  KHÔNG set tay trừ DRAFT/SCHEDULED/CANCELLED.
- Claim kẹt quá `STALE_CLAIM_MS` (30 phút) → tự trả về PENDING khi có máy gọi /ext/queue.

## Quy tắc khi sửa

1. **Nested create không được tenant extension inject `tenantId`** → truyền tay
   (`targets: { create: [{ tenantId, ... }] }`).
2. Route `/api/v1/ext/*` xác thực bằng `withDevice` (device token SHA-256), được bỏ qua
   session ở `auth.config.ts` (`PUBLIC_PREFIXES`). Mọi route ext mới PHẢI bọc `withDevice`.
3. `withTenant`/`withTenantBypass` đã `await` bên trong context — vẫn nên `await` query
   ngay trong callback, đừng trả PrismaPromise ra ngoài.
4. Kịch bản đăng (selector, nhãn EN/VI) là **dữ liệu** ở `packages/shared/src/extension/flows.ts`.
   Đổi giao diện → sửa flow + tăng `version`, không sửa code runner trừ khi cần loại step mới.
   Sửa nóng: env `EXTENSION_FLOWS_OVERRIDE`.
5. Step `waitUrl` phải là step cuối (chỉ cho phép `sleep` sau nó): runner giao cho background
   theo dõi URL vì trang chuyển hướng sẽ huỷ content script.
6. Quy tắc media theo nền tảng ở `validatePostInput()`: YouTube = đúng 1 video + tiêu đề;
   TikTok = cần media; Facebook cho phép chỉ chữ. 1 bài: 1 video HOẶC ≤10 ảnh.
7. Không thêm kỹ thuật né phát hiện (giả fingerprint, random hành vi giả người, proxy).
   Khoảng nghỉ `minGapBetweenPostsMs` là để không dồn bài, không phải để "giống người".

## Test

- api: `DATABASE_URL=... npx jest src/modules/posts` (integration, cần DB đã `db push`)
- Extension: build `npm run build -w @media-ops/extension`, load unpacked; test đầu-cuối có thể
  dùng trang giả lập + `EXTENSION_FLOWS_OVERRIDE` trỏ openUrl về trang đó.
