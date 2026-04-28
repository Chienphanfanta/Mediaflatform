# MIGRATION_PLAN — V1 (Media Ops) → V2 (HR + Channel Performance Tracker)

> Mục đích: chỉ rõ file/folder nào XOÁ, REFACTOR, hoặc TẠO MỚI để chuyển hoàn toàn từ Media Ops Platform sang HR + Channel Performance Tracker đa tenant. Đọc CLAUDE.md V2 trước khi review file này.
>
> **KHÔNG động vào code khi tạo plan này.** Chỉ là kế hoạch để user review & approve.

---

## Executive Summary

- **Tỷ lệ thay đổi:** ~70% codebase V1 phải xoá hoặc rewrite. Chỉ ~30% giữ nguyên (UI primitives shadcn, NextAuth infra, queue scaffolding, PWA assets).
- **Schema:** rewrite 100% — V1 18 models → V2 7 models (Tenant + Employee + Department + Channel + ChannelOwnership + ChannelMetric + KPI). Mất `Post`, `Task`, `CrossPostGroup`, `Group`, `Permission`, `MediaLibrary`, `PostWorkflowHistory`.
- **Multi-tenant** xuyên qua mọi layer: Prisma extension auto-inject `tenantId`, JWT thêm `tenantId` + `tenantSlug`, middleware subdomain routing.
- **Bỏ hoàn toàn:** post creation, scheduling, workflow approval, cross-posting, content adapter, X/Twitter integration, media upload UI.
- **Thêm mới:** KPI module (giao + auto-calc achievement), Department, multi-tenant infra, subscription tier (FREE/STARTER/PRO/ENTERPRISE).

---

## 1. DELETE — file/folder cần xoá hoàn toàn

### 1.1 Web pages (`apps/web/src/app/(dashboard)/`)

```
calendar/                                 # Cả module — bao gồm /calendar/page.tsx + /calendar/failed/page.tsx
review/                                   # Approval workflow queue (Manager+ duyệt bài)
hr/                                       # Replace bằng /employees — folder cũ xoá toàn bộ
```

### 1.2 Web API endpoints (`apps/web/src/app/api/v1/`)

```
posts/                                    # 8 routes: route.ts, [id]/route.ts, [id]/retry, [id]/workflow/{submit-review,approve,reject,revise}, failed
cross-posts/                              # route.ts, [id]/route.ts
calendar/route.ts                         # Calendar event listing
review-queue/route.ts                     # Manager approval queue
users/                                    # Replace by /employees — xoá users/route.ts + users/[id]/route.ts
groups/                                   # Replace by /departments + /tenants — xoá groups/route.ts + members/* + [id]/route.ts
platforms/[platform]/connect/route.ts     # OAuth full-scope flow — V2 chỉ read public, simplified
platforms/[platform]/callback/route.ts    # OAuth callback — refactor thành read-only metric token exchange
platforms/[platform]/disconnect/[channelId]/route.ts
platforms/[platform]/verify/[channelId]/route.ts
platforms/telegram/connect-bot/route.ts   # Bot token submit — V2 dùng master bot
platforms/sync-all/route.ts               # Old stub
platforms/sync-status/route.ts            # Old stub
```

### 1.3 Web components (`apps/web/src/components/`)

```
calendar/                                 # ALL 10 files — author-summary-card, calendar-filters, calendar-grid, calendar-legend, calendar-toolbar, create-post-dialog, cross-post-dialog, event-pill, mobile-calendar, post-detail-dialog
review/review-dialog.tsx                  # Workflow approval modal
dashboard/overview/scheduled-posts.tsx    # Today's scheduled posts widget
dashboard/overview/tasks-due.tsx          # Tasks due widget (Task model bị xoá)
analytics/top-posts.tsx                   # Top posts list — V2 không có Post entity
channels/connect-channel-dialog.tsx       # OAuth full-scope flow — replace bằng simpler "register channel by URL"
channels/sync-status-panel.tsx            # Old sync stub UI
```

### 1.4 Web lib (`apps/web/src/lib/`)

```
workflow.ts                               # submit/approve/reject/revise transitions cho Post
content-adapter.ts                        # 5000/280/2200 chars + hashtag adapt — N/A khi không đăng bài
push-sender.ts                            # Workflow push events — refactor lại trong "REFACTOR" section thay vì xoá hoàn toàn
schemas/post.ts                           # Zod cho create/update post
schemas/cross-post.ts
schemas/group.ts                          # Replace bằng schemas/department.ts + tenant.ts
types/calendar.ts                         # CalendarEvent, CalendarFilters
types/cross-post.ts
types/channels-page.ts                    # Old shape — refactor sang Channel Registry shape
types/dashboard.ts                        # Refactor — vẫn cần nhưng shape khác
hr-metrics.ts                             # Refactor sang lib/kpi-calculation.ts (V2 KPI có scope rõ ràng hơn)
platform-oauth/                           # Folder — V2 chỉ cần API key cho YouTube + master Telegram bot, không OAuth flow cho mỗi tenant
```

### 1.5 Web hooks (`apps/web/src/hooks/`)

```
use-calendar.ts
use-cross-post.ts
use-channel-posts.ts                      # Posts của 1 channel — không có Post entity
use-channels-list.ts                      # 1 trong 2 (use-channels-list / use-channels) sẽ bị xoá hoặc gộp
use-sync-status.ts                        # Old stub sync
```

### 1.6 Web app extras

```
app/api/v1/dashboard/overview/route.ts    # Refactor mạnh — list keep nhưng query khác hoàn toàn
```

### 1.7 Backend modules (`apps/api/src/modules/`)

```
posts/                                    # cross-post.service.ts + posts.module.ts — toàn bộ
queue/workers/post-publisher.worker.ts    # Publish bài thật
queue/services/cron.service.ts            # Post scheduler EVERY_MINUTE
queue/services/best-time.service.ts       # Best-time-to-post calculator — N/A
queue/services/sync-priority.service.ts   # HIGH/NORMAL/LOW priority recompute — V2 đơn giản hoá
platforms/twitter.service.ts              # X/Twitter — V2 KHÔNG support (CLAUDE.md V2 §1)
```

### 1.8 Schema models (`packages/db/prisma/schema.prisma`)

```
Post                                      # entity bài đăng
PostWorkflowHistory                       # workflow audit
CrossPostGroup                            # campaign group
Task                                      # giao việc — V2 thay bằng KPI
Group + GroupMember                       # → V2 Department
Permission + RolePermission               # → V2 dùng EmployeeRole enum đơn giản hơn
MediaLibrary                              # KHÔNG upload media V2

Enums xoá:
  PostStatus, CrossPostGroupStatus, TaskStatus, Priority,
  PermissionAction, MediaType,
  GroupType, MemberRole (replace bằng EmployeeRole)
```

### 1.9 Skill docs (`.claude/skills/`)

```
analytics-patterns.md                     # Refactor thành KPI/metrics patterns — xoá content cũ
platform-integrations.md                  # Refactor: bỏ publish flows, chỉ giữ read-only metrics
scheduler-patterns.md                     # Refactor: bỏ post scheduler, chỉ giữ metrics-sync cron
```

---

## 2. REFACTOR — file giữ nhưng phải sửa lớn

### 2.1 Schema rewrite (CRITICAL)

| File | Refactor scope |
|---|---|
| `packages/db/prisma/schema.prisma` | **REWRITE 100%.** Xoá 11 models V1, viết lại 7 models V2 (Tenant/Employee/Department/Channel/ChannelOwnership/ChannelMetric/KPI). Mọi model trừ Tenant phải có `tenantId String` + `@@index([tenantId, ...])`. Drop platform `X` khỏi Platform enum. |
| `packages/db/prisma/seed.ts` | **REWRITE.** Tạo 2 demo tenants × 3 departments × 5 employees × 4 channels × 90 days metrics × 3 KPIs. Bcrypt password unchanged. |

### 2.2 Auth + Multi-tenant routing

| File | Refactor scope |
|---|---|
| `apps/web/src/auth.ts` | Credentials provider giờ phải verify `(tenantSlug, email)` thay vì chỉ email. JWT callback include `tenantId`, `tenantSlug`, `tenantName`, `subscriptionTier`. |
| `apps/web/src/auth.config.ts` | ROUTE_RBAC viết lại: thay `/hr` → `/employees`, `/review` xoá, thêm `/departments`, `/kpi`, `/admin/tenants` (SUPER_ADMIN only). |
| `apps/web/src/middleware.ts` | Đại tu: parse subdomain từ `Host` header → resolve tenantSlug → verify match JWT.tenantSlug → reject mismatch (subdomain hijack defense). Thêm `/admin.tracker.com` route group. |
| `apps/web/src/lib/rbac.ts` | EffectiveRole đổi từ `SUPERADMIN/GROUP_ADMIN/MANAGER/STAFF/VIEWER` → `SUPER_ADMIN/TENANT_ADMIN/MANAGER/STAFF/VIEWER`. SessionUser type thêm `tenantId`, `tenantSlug`. Bỏ `groups[]` field, thêm `department` (1:1 nullable). |
| `apps/api/src/modules/auth/` (toàn bộ files) | JWT strategy validate tenantId; login flow resolve tenant trước. |
| `apps/web/src/lib/prisma.ts` + `apps/api/src/prisma/prisma.service.ts` | Wrap PrismaClient với `tenantExtension(getTenantId)` — auto-inject vào mọi findMany/findFirst/create/update/delete. Get tenantId từ AsyncLocalStorage hoặc Next request context. |

### 2.3 Channel module — Registry pattern (no OAuth full scope)

| File | Refactor scope |
|---|---|
| `apps/web/src/app/(dashboard)/channels/page.tsx` | UI cũ: grid kênh + nút "Connect new". UI mới: bảng `Channel Registry` — thêm cột "Người phụ trách" (PRIMARY/SECONDARY chips), "Sync status", "Last metric snapshot". Bỏ status panel sticky right (BullMQ-related). |
| `apps/web/src/app/(dashboard)/channels/[id]/page.tsx` (chưa có ở V1 dashboard route — CLAUDE.md V2 thêm) | TẠO MỚI nhưng tham chiếu `analytics/channels/[id]/page.tsx` cũ làm khung. |
| `apps/web/src/app/(dashboard)/channels/connect/page.tsx` | Đổi flow: thay vì OAuth full-scope, chỉ paste channel URL/handle → server resolve `externalId` qua YT Data API key (không cần user OAuth) → save Channel + assign owner ngay form. |
| `apps/web/src/components/channels/channel-card.tsx` | Bỏ status `TOKEN_EXPIRED`, thêm `OwnershipBadge` (PRIMARY/SECONDARY chips). |
| `apps/web/src/app/api/v1/channels/route.ts` | GET unchanged shape (vẫn list theo tenant scope); POST refactor — body chỉ cần `{platform, externalId hoặc URL, name, ownerEmployeeId}`. Bỏ accessToken/refreshToken trong request. |
| `apps/web/src/app/api/v1/channels/[id]/route.ts` | PATCH cho phép đổi name/category/description, KHÔNG cho phép đổi accessToken qua endpoint này. |
| `apps/web/src/app/api/v1/channels/[id]/sync/route.ts` | Trigger 1 metric sync ngay lập tức cho channel này (gọi metrics-sync queue). |

### 2.4 Analytics → Metrics + KPI focus

| File | Refactor scope |
|---|---|
| `apps/web/src/app/(dashboard)/analytics/page.tsx` | Bỏ section "Top Posts" (không Post entity). Thêm "KPI Achievement Overview" — % completion theo department, theo employee. Giữ multi-line chart views theo platform (đổi nguồn data từ ChannelMetric thay Analytics cũ). |
| `apps/web/src/app/(dashboard)/analytics/channels/[id]/page.tsx` | Tab "Nội dung" (post-related) → thay bằng tab "KPI". Tab "Monetization" giữ nhưng đơn giản — chỉ YouTube. Tab "So sánh" giữ. |
| `apps/web/src/components/analytics/top-posts.tsx` | (đã đánh dấu DELETE) |
| `apps/web/src/components/analytics/channel/tab-overview.tsx` | Adapt nguồn data từ `Analytics` model → `ChannelMetric` snapshot daily. |
| `apps/web/src/components/analytics/channel/tab-comparison.tsx` | Same — adapt data source. |
| `apps/web/src/components/analytics/channel/tab-monetization.tsx` | YouTube-specific, simplify (V2 không track post-level monetization). |
| `apps/web/src/lib/analytics-service.ts` | Reuse Redis cache pattern, query refactor: `Analytics` → `ChannelMetric` (different shape). |
| `apps/web/src/lib/types/analytics-summary.ts` | Bỏ `topPosts` field; thêm `kpiAchievement` field. |

### 2.5 Dashboard

| File | Refactor scope |
|---|---|
| `apps/web/src/app/(dashboard)/dashboard/page.tsx` | Layout hiện tại: 4 KPI + 2 charts + 2 lists + channel health. Layout V2: 4 KPI cards (Total channels, Total followers tenant-wide, KPI achievement %, Active employees) + Followers growth chart + KPI overview by department + Top performing channels list. **Bỏ** scheduled posts, tasks due. |
| `apps/web/src/components/dashboard/overview/metric-cards.tsx` | Adapt — fields khác (followers tổng tenant, channels active, KPI achievement %, employees active). |
| `apps/web/src/components/dashboard/overview/views-chart.tsx` | Đổi nguồn data ChannelMetric. |
| `apps/web/src/components/dashboard/overview/top-posts-chart.tsx` | (đã đánh dấu DELETE) |
| `apps/web/src/components/dashboard/overview/channel-health.tsx` | Refactor: bỏ post-related fields, focus sync status + last KPI snapshot. |
| `apps/web/src/app/api/v1/dashboard/overview/route.ts` | Rewrite query: 9 parallel Prisma queries hiện tại → 5-6 queries mới (totals + KPI aggregate + channels). |
| `apps/web/src/hooks/use-dashboard-overview.ts` | Adapt response type. |

### 2.6 Profile + HR module renaming

| File | Refactor scope |
|---|---|
| `apps/web/src/app/(dashboard)/profile/page.tsx` | Hiện hiển thị groups + role; V2 thay bằng `position` + `department.name` + `employeeRole`. Loại "Hồ sơ KPI" link đổi `/hr/[id]` → `/employees/[id]`. |
| `apps/web/src/app/(dashboard)/hr/` | (đã đánh dấu DELETE entire folder) — content sẽ migrate sang `/employees/`. |
| `apps/web/src/components/dashboard/page-title.tsx` | LABELS map: thay `hr` → `employees`, thêm `departments`, `kpi`, `tenant`, `billing`. |
| `apps/web/src/components/dashboard/nav-items.tsx` | NAV_ITEMS V2: Tổng quan / Nhân sự (`/employees`) / Phòng ban (`/departments`) / Kênh / KPI / Phân tích / Báo cáo / Cảnh báo / Cài đặt. Bỏ "Duyệt bài". minRole đổi từ `MANAGER/GROUP_ADMIN` → V2 5-role enum. |
| `apps/web/src/components/dashboard/sidebar.tsx` | Header thêm tenant logo + tenant name từ session.user.tenantName. |
| `apps/web/src/components/dashboard/topbar.tsx` | Tenant context hiển thị (vd "ABC Media · Super Admin"). |
| `apps/web/src/components/dashboard/user-menu.tsx` | Avatar dropdown thêm "Switch tenant" (chỉ SUPER_ADMIN). |

### 2.7 Reports

| File | Refactor scope |
|---|---|
| `apps/web/src/app/(dashboard)/reports/page.tsx` | Bỏ ReportType `CHANNEL/CONTENT/CUSTOM`. Giữ `HR` và thêm `KPI_ACHIEVEMENT`, `CHANNEL_GROWTH`, `DEPARTMENT_SUMMARY`. |
| `apps/web/src/lib/reports/generate.ts` | `buildHRReport` refactor cho Employee model + Department aggregation. Bỏ `buildChannelReport`/`buildContentReport`. Thêm `buildKpiAchievementReport`, `buildChannelGrowthReport`. |
| `apps/web/src/lib/reports/csv.ts` | Generic CSV — keep, adapt headers theo report type mới. |
| `apps/web/src/lib/reports/pdf.tsx` | React-PDF templates — refactor theo report type mới. |
| `apps/web/src/lib/types/reports.ts` | Type definitions — refactor. |
| `apps/web/src/lib/schemas/reports.ts` | Zod input schema. |

### 2.8 Alerts → KPI alerts

| File | Refactor scope |
|---|---|
| `apps/api/src/modules/alerts/alert-engine.service.ts` | 4 detector hiện tại (VIEW_DROP / MONETIZATION / CHANNEL_INACTIVE / TOKEN_EXPIRY) → giữ 3, bỏ MONETIZATION_AT_RISK; thêm KPI_AT_RISK (achievement < expected pace) + CHANNEL_NOT_SYNCING (last sync > 6h). |
| `apps/api/src/modules/alerts/alerts.service.ts` | Detector methods rewrite cho ChannelMetric. |
| `apps/api/src/modules/alerts/alerts.cron.ts` | Cron schedule unchanged (hourly); detector list cập nhật. |
| `apps/api/src/modules/alerts/notification.service.ts` | Recipient resolution: `channel.owner` → `ChannelOwnership.PRIMARY` employee + DepartmentManager. Email template adapt. |
| `apps/api/src/modules/alerts/push-notification.service.ts` | Event types đổi: bỏ `workflow-*` + `post-failed`; thêm `kpi-at-risk` + `channel-sync-failed`. |
| `apps/web/src/lib/types/alerts.ts` | AlertType enum mới (drop SCHEDULED_POST_FAILED, MONETIZATION_LOST, MONETIZATION_AT_RISK; add KPI_AT_RISK, CHANNEL_NOT_SYNCING). |
| `apps/web/src/app/(dashboard)/alerts/page.tsx` | Filter chips update theo AlertType mới. |

### 2.9 Queue + Workers

| File | Refactor scope |
|---|---|
| `apps/api/src/modules/queue/queue.module.ts` | Bỏ post-publisher queue + worker. Còn lại 3 queues: analytics-sync (rename → metrics-sync), alert-checker, notification-sender. |
| `apps/api/src/modules/queue/queues.constants.ts` | QUEUE_NAMES bỏ `POST_PUBLISHER`; rename `ANALYTICS_SYNC` → `METRICS_SYNC`. WORKER_OPTIONS reset. JOB_TIMEOUT_MS bỏ POST_PUBLISHER. |
| `apps/api/src/modules/queue/services/analytics-cron.service.ts` | RENAME → `metrics-cron.service.ts`. Bỏ 4 schedules cũ phức tạp. Giữ 2: `EVERY_HOUR` (sync metrics tất cả active channels) + `0 7 * * *` (daily 7AM full snapshot + recalculate KPI achievement). |
| `apps/api/src/modules/queue/workers/analytics-sync.worker.ts` | RENAME → `metrics-sync.worker.ts`. Drop SyncPriority logic. Per-tenant quota tracking thay global. Output `ChannelMetric` thay `Analytics`. |
| `apps/api/src/modules/queue/services/youtube-quota.service.ts` | Refactor: Redis key `quota:tenant-{id}:youtube:{date}` thay `yt:quota:{date}` global. |
| `apps/api/src/modules/queue/services/sync-log.service.ts` | Keep — generic audit. |
| `apps/api/src/modules/queue/services/job-log.service.ts` | Keep. |
| `apps/api/src/modules/queue/services/queue-monitor.service.ts` | Keep — health check generic. |
| `apps/api/src/modules/queue/services/queue.service.ts` | Bỏ `enqueuePostPublish`, `enqueueScheduledPost`. Còn `enqueueMetricsSync`, `enqueueAlertCheck`, `enqueueNotification`. |
| `apps/api/src/modules/queue/types/job-types.ts` | Drop `PostPublishJob`. Rename `AnalyticsSyncJob` → `MetricsSyncJob`. |
| `apps/api/src/modules/queue/bull-board.setup.ts` | Keep — Bull Board UI generic. |

### 2.10 Platform services — read-only mode

| File | Refactor scope |
|---|---|
| `apps/api/src/modules/platforms/youtube.service.ts` | Giữ `syncChannelStats` (rename → `fetchChannelMetrics`), `syncChannelVideos` (drop), `checkMonetizationStatus` (drop), `uploadVideo` (drop), `scheduleVideo` (drop). |
| `apps/api/src/modules/platforms/meta.service.ts` | Giữ `syncPageInsights` + `syncInstagramInsights` (rename → `fetch*Metrics`). Drop `publishPost`, `publishInstagramPost`, `publishInstagramReel`, `getPostInsights`. |
| `apps/api/src/modules/platforms/telegram.service.ts` | Giữ `syncChannelStats` (rename → `fetchChannelMetrics`). Drop `sendMessage/Photo/Video`, `pinMessage`. Master bot token thay tenant-specific. |
| `apps/api/src/modules/platforms/whatsapp.service.ts` | Giữ `getGroupStats` (rename → `fetchGroupMetrics`). Drop `sendTextMessage`, `sendMediaMessage`, `sendBroadcast`. |
| `apps/api/src/modules/platforms/base-platform.service.ts` | Refactor: bỏ `withTokenRefresh` cho POST flows. Single `fetchMetrics()` abstract method. |
| `apps/api/src/modules/platforms/twitter.service.ts` | (đã đánh dấu DELETE) |
| `apps/api/src/modules/platforms/youtube-api-client.ts` | Keep — generic HTTP client. |
| `apps/api/src/modules/platforms/meta-api-client.ts` | Keep. |
| `apps/api/src/modules/platforms/platforms.module.ts` | Drop TwitterService provider + export. |

### 2.11 Cross-cutting

| File | Refactor scope |
|---|---|
| `.env.example` | Bỏ `X_*` (Twitter), thêm `ROOT_DOMAIN`, `ADMIN_SUBDOMAIN`, `ENABLE_SUBDOMAIN_ROUTING`. `TELEGRAM_BOT_TOKEN` đổi thành master bot. |
| `docker-compose.yml` | Mostly keep. Có thể thêm Caddy/Traefik service làm subdomain reverse proxy cho dev local (`*.tracker.local`). |
| `apps/web/public/manifest.json` | App name đổi `Media Ops Platform` → `HR + Channel Performance Tracker`. Short name `MediaOps` → `HRTracker`. Theme color có thể giữ. Icons replaced (P3.2 từ Phase 8 vẫn pending). |
| `apps/web/scripts/generate-pwa-icons.mjs` | Keep, glyph "M" → "HR" hoặc logo mới. |
| `apps/web/src/app/layout.tsx` | metadata.title + applicationName + appleWebApp.title đổi tên. |
| `apps/web/public/robots.txt` | Disallow paths cập nhật (bỏ /calendar, /review; thêm /employees, /departments, /kpi). |
| `apps/web/src/app/sitemap.ts` | Pure public pages — keep `/login`, `/offline`. Add `/signup-tenant`. |
| `apps/web/src/lib/platform.ts` | Drop X từ `PLATFORMS` array, `PLATFORM_LABEL`, `PLATFORM_DOT`, `PLATFORM_BG`. |
| `apps/web/src/lib/alerts-style.ts` | Adapt cho AlertType mới. |
| `apps/web/src/lib/push-sender.ts` | Workflow event types remove (`workflow-approved/rejected/submitted`). Add `kpi-at-risk`, `channel-sync-failed`. |
| `apps/web/src/components/layout/notification-bell.tsx` | Polling endpoint không đổi; data shape adapt theo AlertType mới. |
| `apps/web/src/app/api/v1/admin/queues/*` | Bull Board admin — keep, just check không expose post-publisher (đã xoá). |
| `apps/web/src/components/admin/job-detail-dialog.tsx` | Keep. |

### 2.12 Skill docs (`.claude/skills/`)

| File | Refactor scope |
|---|---|
| `api-patterns.md` | Update conventions: tenant context handling, Prisma extension reuse. |
| `database-queries.md` | Update: mọi query implicit qua tenant extension; soft-delete pattern simplify. |
| `rbac-patterns.md` | Rewrite cho 5-role V2 + tenant scope. |
| `ui-components.md` | Mostly keep — shadcn primitives unchanged. |
| `testing-guide.md` | Test cases refactor (KPI, employee, tenant). |
| `analytics-patterns.md` | Rename → `metrics-patterns.md`; rewrite. |
| `platform-integrations.md` | Drop publish flows, keep read-only sections. |
| `scheduler-patterns.md` | Strip post-publisher; keep metrics-sync only. |

---

## 3. NEW — file/folder cần TẠO MỚI

### 3.1 Schema infra

```
packages/db/tenant-extension.ts                 # Prisma extension auto-inject tenantId
packages/db/prisma/schema.prisma                # (REWRITE — đã liệt kê ở §2.1, đề cập lại để dễ track)
```

### 3.2 Web pages (`apps/web/src/app/(dashboard)/`)

```
employees/page.tsx                              # List employees (replace /hr)
employees/[id]/page.tsx                         # Employee detail + KPI assigned (replace /hr/[id])
employees/new/page.tsx                          # Form thêm employee (TENANT_ADMIN+)
departments/page.tsx                            # CRUD phòng ban
departments/[id]/page.tsx                       # Department detail + member list
kpi/page.tsx                                    # KPI overview (filter by employee/channel/period)
kpi/assign/page.tsx                             # Form giao KPI mới (Manager+)
kpi/[id]/page.tsx                               # KPI detail + progress chart
settings/tenant/page.tsx                        # Tenant settings (logo, timezone, currency)
settings/integrations/page.tsx                  # Connect platforms để sync metrics (read-only)
settings/billing/page.tsx                       # Subscription + plan upgrade
admin/                                          # NEW route group — SUPER_ADMIN only
  tenants/page.tsx                              # List tất cả tenants
  tenants/[id]/page.tsx                         # Tenant detail + override
  layout.tsx                                    # Admin layout khác dashboard layout
```

### 3.3 Web auth

```
app/(auth)/signup-tenant/page.tsx               # Onboarding tenant mới (form + tenant creation)
app/(auth)/select-tenant/page.tsx               # Khi user thuộc nhiều tenants — chọn tenant để vào
```

### 3.4 Web API endpoints

```
app/api/v1/tenants/route.ts                     # GET (super admin), POST (create new tenant)
app/api/v1/tenants/[id]/route.ts                # GET, PATCH, DELETE (super admin); GET self for tenant_admin
app/api/v1/tenants/current/route.ts             # GET current user's tenant info
app/api/v1/employees/route.ts                   # GET (list), POST (create)
app/api/v1/employees/[id]/route.ts              # GET, PATCH, DELETE
app/api/v1/employees/[id]/terminate/route.ts    # POST domain action
app/api/v1/departments/route.ts
app/api/v1/departments/[id]/route.ts
app/api/v1/departments/[id]/members/route.ts    # Move employees vào/ra department
app/api/v1/channels/[id]/ownerships/route.ts    # GET/POST — assign owner
app/api/v1/channels/[id]/ownerships/[ownershipId]/route.ts # PATCH role / DELETE
app/api/v1/channels/[id]/metrics/route.ts       # GET history snapshots
app/api/v1/kpi/route.ts                         # GET (list with filter), POST (assign new)
app/api/v1/kpi/[id]/route.ts                    # GET, PATCH, DELETE
app/api/v1/kpi/[id]/recalculate/route.ts        # POST recalc achievement %
app/api/v1/integrations/[platform]/route.ts     # POST connect (read-only token), DELETE
app/api/v1/admin/tenants/route.ts               # Super admin scope
app/api/v1/admin/tenants/[id]/suspend/route.ts
```

### 3.5 Web lib

```
lib/types/tenant.ts                             # Tenant, SubscriptionTier types
lib/types/employee.ts                           # Employee, EmployeeRole types
lib/types/department.ts
lib/types/kpi.ts                                # KPI types với KPIScope, PeriodType
lib/types/channel-metric.ts                     # ChannelMetric snapshot type
lib/schemas/tenant.ts                           # Zod schema
lib/schemas/employee.ts
lib/schemas/department.ts
lib/schemas/kpi.ts                              # Validate giao KPI form
lib/schemas/channel-ownership.ts
lib/kpi-calculation.ts                          # Algorithm tính achievement % từ ChannelMetric
lib/tenant-context.ts                           # getTenantId() từ session/headers — server-only
lib/subdomain.ts                                # parseSubdomainFromHost helper
```

### 3.6 Web hooks

```
hooks/use-employees.ts
hooks/use-employee.ts                           # Single employee
hooks/use-departments.ts
hooks/use-kpi-list.ts
hooks/use-kpi.ts                                # Single KPI
hooks/use-channel-metrics.ts                    # History snapshots
hooks/use-tenant.ts                             # Current tenant info
hooks/use-channel-ownership.ts
```

### 3.7 Web components

```
components/employees/employee-card.tsx
components/employees/employee-form.tsx          # Reuse cho Create + Edit
components/employees/employee-detail-tabs.tsx   # Tabs Profile / KPI / Channels
components/departments/department-card.tsx
components/departments/department-form.tsx
components/kpi/kpi-form.tsx                     # Form giao KPI (scope toggle PER_CHANNEL / PER_EMPLOYEE)
components/kpi/kpi-card.tsx                     # Display KPI với progress bar
components/kpi/kpi-progress-bar.tsx             # Reusable visual
components/kpi/period-picker.tsx                # MONTHLY/QUARTERLY/YEARLY + range
components/channels/channel-ownership-list.tsx  # PRIMARY/SECONDARY chips + assign UI
components/channels/channel-registry-table.tsx  # Table replace channel-card grid
components/tenant/tenant-header.tsx             # Logo + name trong sidebar
components/tenant/subscription-badge.tsx        # FREE/STARTER/PRO/ENTERPRISE pill
```

### 3.8 Backend modules

```
apps/api/src/modules/tenants/
  tenants.module.ts
  tenants.controller.ts
  tenants.service.ts
  dto/create-tenant.dto.ts
  dto/update-tenant.dto.ts

apps/api/src/modules/employees/
  employees.module.ts
  employees.controller.ts
  employees.service.ts
  dto/

apps/api/src/modules/departments/
  departments.module.ts
  departments.controller.ts
  departments.service.ts

apps/api/src/modules/kpi/
  kpi.module.ts
  kpi.controller.ts
  kpi.service.ts
  kpi-calculator.service.ts                     # Auto recalc achievement %
  kpi.cron.ts                                   # Daily 7AM recalculation

apps/api/src/modules/metrics/                   # Replace `analytics` module (V1 chưa có module riêng nhưng concept tương đương)
  metrics.module.ts
  metrics.service.ts                            # Aggregate ChannelMetric

apps/api/src/common/tenant/
  tenant.middleware.ts                          # Resolve tenantId từ JWT/header
  tenant-context.service.ts                     # AsyncLocalStorage wrapper
  tenant.decorator.ts                           # @CurrentTenant() decorator

apps/api/src/common/guards/
  tenant-scope.guard.ts                         # Check resource thuộc tenant
  super-admin.guard.ts                          # SUPER_ADMIN only
```

### 3.9 Scripts + docs

```
scripts/setup-tenant.sh                         # CLI: tạo tenant + admin user mặc định
scripts/seed-demo-data.ts                       # Seed per-tenant demo (employees, channels, KPI)
INSTALL_GUIDE.md                                # Hướng dẫn cài cho team mới (docker compose + setup-tenant)

.claude/skills/multi-tenant-patterns.md         # Query filter, JWT, subdomain pattern
.claude/skills/metrics-sync-patterns.md         # Hourly sync + per-tenant quota tracking
.claude/skills/kpi-calculation.md               # Algorithm tính achievement % (linear vs exponential expectation)
```

---

## 4. Risk Assessment

### 🔴 Critical — DATA risk (mất data nếu sai)

| Item | Risk | Mitigation |
|---|---|---|
| `schema.prisma` rewrite | Drop 11 tables = mất TẤT CẢ data hiện tại (Posts, Tasks, CrossPostGroup, Workflow history) | (a) Backup Postgres trước khi migrate. (b) Migration plan: prepare V2 schema TRÊN DB MỚI riêng, demo + verify trước khi chạy production. (c) V1 data hiện tại là seed test — không phải production data, OK drop. |
| `seed.ts` rewrite | Test users credentials đổi → dev login lại không vào được nếu chưa update workflow | Document login credentials mới ngay khi viết seed. |
| Prisma tenant extension wrap | Sai logic = leak data cross-tenant (vd Manager A xem được Employee của Tenant B) | Unit test cẩn thận — verify mọi findMany có tenantId filter. Test với 2 tenants demo. |
| `auth.ts` JWT refactor | JWT cũ không còn valid → mọi user phải login lại; sai logic = bypass auth | Versioning JWT: thêm `v: 2` field; reject token thiếu/sai version. |

### 🟠 High — Auth/RBAC risk (security issue)

| Item | Risk | Mitigation |
|---|---|---|
| `middleware.ts` subdomain routing | Sai parse → user vào tenant khác | Unit test parseSubdomainFromHost với edge cases (localhost, IP, no subdomain, double dot). |
| `rbac.ts` 5-role mapping | EmployeeRole sai mapping → Manager bypass thành Admin | Permission matrix test theo role × resource (tương tự V1 đã có). |
| `tenant-scope.guard.ts` | Forget guard ở 1 endpoint = leak | Apply globally qua APP_GUARD trong app.module, allowlist explicit cho public endpoints. |
| Encryption key rotation | Đổi `ENCRYPTION_KEY` → mọi accessToken cũ không decrypt được | Document migration script để rotate (đã ghi KNOWN ISSUES #28 V1 — chưa làm). |

### 🟡 Medium — Integration risk (broken sync)

| Item | Risk | Mitigation |
|---|---|---|
| Platform service refactor (drop publish methods) | Method bị xoá còn caller → compile error | TypeScript strict bắt được. Check sau mỗi bước xoá. |
| `analytics-cron` → `metrics-cron` rename + reschedule | Cron mới chạy duplicate với cron cũ trong transition | Stop dev server, migrate xong rồi start lại. |
| YouTube quota tracking per-tenant | Track sai → tenant ăn quota lẫn nhau | Test với 2 tenants demo, verify Redis key namespacing. |
| Master Telegram bot token | 1 bot dùng chung tất cả tenants → bot phải được add admin vào mọi channel | Document trong INSTALL_GUIDE.md. |

### 🟢 Low — UI risk (visual only)

| Item | Risk | Mitigation |
|---|---|---|
| Component rename + restructure | Broken import paths | grep-and-replace + tsc verify. |
| Skill docs refactor | Outdated reference | Cập nhật cùng commit với code. |
| PWA manifest rename | App icon trên home screen vẫn hiện tên cũ cho user đã install | Acceptable — instruct re-install. |
| Sidebar nav restructure | User confused tạm thời | Release notes trong UI. |

---

## 5. Refactor Order — leaf-first dependency-safe

### Sprint 0 — Setup (0.5 ngày)

1. **Backup Postgres** + commit current state lên git branch `v1-final` (rollback safety)
2. **Tạo branch `v2/migration`**
3. **Document login credentials cũ** vào BUGS.md (reference khi compare)

### Sprint 1 — Delete leaf nodes (1 ngày)

> Mục tiêu: xoá UI/code nào KHÔNG có dependency outgoing — không break compile khi xoá.

1. **Xoá pages UI cuối nhánh** (không có ai import vào):
   - `apps/web/src/app/(dashboard)/calendar/` (entire folder + sub-routes)
   - `apps/web/src/app/(dashboard)/review/`
   - `apps/web/src/app/(dashboard)/hr/`
2. **Xoá components dùng riêng cho pages trên:**
   - `components/calendar/*` (10 files)
   - `components/review/review-dialog.tsx`
3. **Xoá hooks dùng riêng:**
   - `use-calendar.ts`, `use-cross-post.ts`, `use-channel-posts.ts`, `use-sync-status.ts`
4. **Xoá API endpoints không có UI consumer (đã xoá):**
   - `api/v1/calendar/route.ts`, `review-queue/route.ts`
   - `api/v1/posts/**` (entire tree)
   - `api/v1/cross-posts/**`
5. **Xoá nav-items entries:** comment ra `/calendar`, `/review`, `/hr` trong nav-items.tsx + ROUTE_RBAC. Bỏ luôn DocumentTitleSync labels cũ.
6. **`tsc --noEmit`** sau mỗi bước.

### Sprint 2 — Delete backend leaf (0.5 ngày)

1. `apps/api/src/modules/posts/` (entire folder)
2. `apps/api/src/modules/queue/workers/post-publisher.worker.ts`
3. `apps/api/src/modules/queue/services/cron.service.ts`, `best-time.service.ts`, `sync-priority.service.ts`
4. `apps/api/src/modules/platforms/twitter.service.ts`
5. Strip publish methods trong `meta.service.ts`, `youtube.service.ts`, `telegram.service.ts`, `whatsapp.service.ts` — chỉ giữ `sync*` methods
6. `apps/api/src/modules/queue/queue.module.ts` + `queues.constants.ts` — bỏ `POST_PUBLISHER` queue, drop `enqueuePostPublish`
7. `tsc --noEmit` (apps/api)

### Sprint 3 — Schema migration (1 ngày)

> 🔴 **HIGH RISK STEP** — schema thay đổi.

1. **Backup Postgres dump.**
2. **Rewrite `schema.prisma`** với 7 V2 models (Tenant + Employee + Department + Channel + ChannelOwnership + ChannelMetric + KPI). Drop 11 V1 models, bỏ enum X.
3. **Tạo `tenant-extension.ts`** ở `packages/db/`.
4. **Run `prisma db push --force-reset`** (dev only) — drop all + recreate.
5. **Rewrite `seed.ts`** với 2 demo tenants. Run seed.
6. **Verify:** Prisma Studio mở, check 7 tables có data.
7. **Document new login credentials** trong BUGS.md.

### Sprint 4 — Tenant + Auth infra (1 ngày)

> 🟠 Sau schema, build tenant context + auth refactor.

1. `apps/api/src/common/tenant/` (3 files: middleware + context-service + decorator)
2. `apps/api/src/common/guards/tenant-scope.guard.ts` + `super-admin.guard.ts`
3. Wrap `apps/api/src/prisma/prisma.service.ts` với tenant extension
4. `apps/api/src/modules/auth/*` — JWT include tenantId
5. `apps/web/src/auth.config.ts` + `auth.ts` — credentials provider tenant-aware
6. `apps/web/src/middleware.ts` — subdomain resolution + JWT verify
7. `apps/web/src/lib/rbac.ts` — V2 5-role enum
8. `apps/web/src/lib/prisma.ts` — wrap với tenant extension
9. **Test login** với 2 tenants demo qua subdomain `tenant1.localhost:3001` (cần config dev DNS hoặc dùng hosts file)

### Sprint 5 — Build new modules backend (2 ngày)

> Build thứ tự: Tenant → Employee → Department → Channel → KPI → Metrics

1. `apps/api/src/modules/tenants/`
2. `apps/api/src/modules/employees/`
3. `apps/api/src/modules/departments/`
4. Refactor `apps/api/src/modules/channels/` (folder hiện tại trống, build mới Channel + ChannelOwnership)
5. `apps/api/src/modules/kpi/` + `kpi-calculator.service.ts` + `kpi.cron.ts`
6. `apps/api/src/modules/metrics/`
7. Refactor `apps/api/src/modules/queue/` — rename analytics-sync → metrics-sync, refactor cron schedules
8. Refactor `apps/api/src/modules/alerts/` — bỏ MONETIZATION/SCHEDULED_POST_FAILED detector, thêm KPI_AT_RISK + CHANNEL_NOT_SYNCING
9. Refactor `apps/api/src/modules/platforms/*` — keep `fetch*Metrics()` methods only

### Sprint 6 — Build new pages web (2 ngày)

> Theo flow user — pages cơ bản trước (employees), advanced sau (KPI, admin)

1. **API endpoints first:**
   - `app/api/v1/tenants/*`
   - `app/api/v1/employees/*`
   - `app/api/v1/departments/*`
   - `app/api/v1/channels/[id]/ownerships/*` + `metrics/*`
   - `app/api/v1/kpi/*`
2. **Types + schemas + hooks:** lib/types, lib/schemas, hooks/use-*
3. **Pages list/detail (basic CRUD):**
   - `/employees` + `/employees/[id]`
   - `/departments` + `/departments/[id]`
4. **Channel Registry:** refactor `/channels/page.tsx` + components
5. **KPI module:**
   - `/kpi/page.tsx` + `/kpi/[id]`
   - `/kpi/assign/page.tsx` (form)
   - components/kpi/*
6. **Refactor `/dashboard/page.tsx`** với KPI overview + new metrics
7. **Refactor `/analytics/*`** — strip top posts, add KPI achievement
8. **Refactor `/profile/page.tsx`** — show position + department
9. **Refactor `/reports/*`** — HR/KPI/Channel-Growth reports
10. **`/settings/tenant`, `/settings/integrations`, `/settings/billing`**
11. **Super admin:** `/admin/tenants/*`
12. **`/(auth)/signup-tenant`, `/(auth)/select-tenant`**
13. **Sidebar/topbar/nav-items refactor** — V2 menu

### Sprint 7 — Polish + cleanup (0.5 ngày)

1. Refactor 8 skill docs trong `.claude/skills/`
2. Update `.env.example` (drop X, add ROOT_DOMAIN)
3. Update `docker-compose.yml` (optional Caddy reverse proxy)
4. Update `apps/web/public/manifest.json` + regenerate icons
5. Update `app/layout.tsx` metadata + robots.txt + sitemap
6. Tạo `INSTALL_GUIDE.md` + `scripts/setup-tenant.sh` + `scripts/seed-demo-data.ts`
7. **Final type-check** + smoke test all routes
8. Update `BUGS.md` — clear V1 fixed bugs lưu thành reference, fresh start cho V2

### Sprint 8 — V2 Phase 9 features (defer) (TBD)

- Multi-tenant testing infrastructure (Vitest setup with tenant fixtures)
- Webhook handlers cho real-time platform events (read-only)
- E2E Playwright suite refactor
- Subdomain dev DNS config script

---

## Tổng effort estimate

| Sprint | Effort | Note |
|---|---|---|
| 0 — Setup | 0.5 ngày | |
| 1 — Delete UI leaves | 1 ngày | Tsc check rất hiệu quả ở bước này |
| 2 — Delete backend leaves | 0.5 ngày | |
| 3 — Schema rewrite | 1 ngày | 🔴 HIGH RISK — backup trước |
| 4 — Tenant + Auth | 1 ngày | 🟠 Test cẩn thận |
| 5 — Build backend new | 2 ngày | |
| 6 — Build pages web | 2 ngày | Largest sprint |
| 7 — Polish | 0.5 ngày | |
| **TOTAL** | **8.5 ngày** | Solo dev, không tính holiday |

Multi-tenant + KPI là refactor lớn — không nên cố làm 1 đêm. Recommend split 2 weeks (1 sprint/ngày).

---

## Câu hỏi user cần quyết định trước khi bắt đầu

1. **Subdomain routing local dev:** dùng `tenant1.localhost:3001` (Next.js native support) hay set hosts file `127.0.0.1 abc.tracker.local`? Chrome support `*.localhost` mặc định, Firefox cần config.
2. **Master Telegram bot:** có sẵn bot duy nhất hay mỗi tenant tự cấp? Master đơn giản hơn nhưng tenant phải add bot vào channel/group của họ.
3. **Subscription billing:** chỉ track `subscriptionTier` (manual upgrade qua admin panel) hay tích hợp Stripe luôn? Stripe defer Phase 10.
4. **Migration data V1 → V2:** discard hoàn toàn (V1 data hiện là seed test) hay cần migrate Channel + User cũ sang V2 schema (employee + tenant default)? Với data hiện tại của bạn, đề xuất discard.
5. **`X (Twitter)` integration:** confirm bỏ luôn hay giữ option? CLAUDE.md V2 §1 chỉ list 5 platforms (YT/FB/IG/Telegram/WhatsApp).

Báo lại các câu trả lời này, tôi sẽ adjust plan trước khi execute.

---

## Out of scope cho migration này

- Stripe billing thật (chỉ track tier enum)
- Email signup verification flow (đơn giản hoá: signup tenant → admin tạo manual)
- Two-factor auth (Phase 10)
- Audit log UI cho tenant changes
- I18n (giữ Vietnamese only)
- Real-time updates (websocket/SSE)

Tất cả các item trên defer Phase 10+ sau khi V2 stable.
