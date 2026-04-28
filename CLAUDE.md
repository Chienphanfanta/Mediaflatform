# CLAUDE.md — HR + Channel Performance Tracker

> Đọc file này TRƯỚC KHI làm bất cứ điều gì. Đây là source of truth cho dự án.

---

## PROJECT OVERVIEW

**Tên dự án:** HR + Channel Performance Tracker
**Mô hình:** Multi-tenant SaaS (single-instance, nhiều team dùng chung)
**Mục tiêu chính:** Web admin tool giúp công ty truyền thông quản lý nhân sự, giao KPI và theo dõi tăng trưởng các kênh truyền thông từ một nơi duy nhất.

**Bài toán giải quyết:**
- Quản lý nhân viên: thông tin, vai trò, phòng ban, lịch sử công tác
- Khai báo và phân công kênh truyền thông cho từng nhân viên (1 nhân viên có thể quản lý nhiều kênh, 1 kênh có thể có nhiều nhân viên hỗ trợ)
- Giao KPI dual-level: KPI cho từng kênh riêng + KPI tổng cho từng nhân viên
- Tự động sync metrics mỗi giờ từ YouTube, Facebook, Instagram, Telegram, WhatsApp
- Dashboard tăng trưởng với granularity: tổng công ty / phòng ban / nhân viên / kênh
- Có thể bán hoặc cài đặt cho team khác (mỗi team là 1 tenant riêng biệt)

**KHÔNG làm:**
- KHÔNG tạo bài viết, KHÔNG đăng bài, KHÔNG schedule posts
- KHÔNG approval workflow
- KHÔNG cross-posting hoặc media library
- KHÔNG tạo content hay edit content

**Đây là READ-ONLY monitoring tool.** Mọi tương tác với platforms chỉ là GET metrics, không bao giờ POST/PUT/DELETE.

---

## TECH STACK

### Frontend — /apps/web
- **Framework:** Next.js 14 (App Router, TypeScript)
- **Styling:** TailwindCSS + shadcn/ui
- **State:** Zustand (global), React Query (server state)
- **Forms:** react-hook-form + Zod validation
- **Charts:** Recharts
- **Auth:** NextAuth.js v5 (multi-tenant aware)
- **Date:** date-fns + date-fns-tz

### Backend — /apps/api
- **Framework:** NestJS (TypeScript)
- **ORM:** Prisma (với multi-tenant middleware)
- **Database:** PostgreSQL với Row-Level Security
- **Cache/Queue:** Redis + BullMQ
- **Auth:** JWT + Passport (token chứa tenantId + userId + role)
- **Docs:** Swagger (@nestjs/swagger)
- **Validation:** class-validator + class-transformer

### Shared packages
- **/packages/db** — Prisma schema, migrations, seed
- **/packages/shared** — Types, constants, utils dùng chung

---

## REPOSITORY STRUCTURE

```
hr-channel-tracker/
├── apps/
│   ├── web/                    # Next.js 14 frontend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/                # Login, signup tenant
│   │   │   │   ├── (dashboard)/
│   │   │   │   │   ├── page.tsx           # Overview
│   │   │   │   │   ├── employees/         # HR module
│   │   │   │   │   │   ├── page.tsx       # List employees
│   │   │   │   │   │   └── [id]/page.tsx  # Per-employee detail
│   │   │   │   │   ├── departments/       # Phòng ban
│   │   │   │   │   ├── channels/          # Channel registry
│   │   │   │   │   │   ├── page.tsx
│   │   │   │   │   │   └── [id]/page.tsx
│   │   │   │   │   ├── kpi/               # KPI module
│   │   │   │   │   │   ├── page.tsx       # KPI overview
│   │   │   │   │   │   └── assign/page.tsx # Giao KPI
│   │   │   │   │   ├── analytics/         # Tăng trưởng
│   │   │   │   │   ├── reports/           # Báo cáo
│   │   │   │   │   └── settings/
│   │   │   │   │       ├── tenant/        # Cài đặt tenant
│   │   │   │   │       ├── integrations/  # Kết nối platforms
│   │   │   │   │       └── billing/       # Subscription
│   │   │   │   └── api/v1/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   └── types/
│   └── api/                    # NestJS backend
│       └── src/
│           ├── modules/
│           │   ├── auth/
│           │   ├── tenants/        # Tenant management
│           │   ├── employees/      # HR module
│           │   ├── departments/
│           │   ├── channels/       # Channel registry
│           │   ├── kpi/            # KPI management
│           │   ├── metrics/        # Read-only sync from platforms
│           │   ├── analytics/      # Aggregation & reporting
│           │   └── platforms/      # Read-only platform clients
│           │       ├── youtube/
│           │       ├── meta/       # Facebook + Instagram
│           │       ├── telegram/
│           │       └── whatsapp/
│           └── common/
│               ├── tenant/         # Multi-tenant middleware
│               ├── guards/
│               └── decorators/
├── packages/
│   ├── db/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── tenant-extension.ts  # Prisma extension for tenant filtering
│   └── shared/
├── .claude/
│   └── skills/
├── scripts/
│   ├── setup-tenant.sh         # Tạo tenant mới
│   └── seed-demo-data.ts       # Seed data demo
├── docker-compose.yml          # 1-command install
├── INSTALL_GUIDE.md            # Hướng dẫn cài đặt
├── CLAUDE.md                   # ← File này
└── .env.example
```

---

## DATABASE MODELS — Multi-tenant

### Core principle: Mọi bảng (trừ Tenant) đều có `tenantId`

```prisma
// 1. Tenant — root entity
model Tenant {
  id              String   @id @default(cuid())
  name            String                  // "Công ty ABC"
  slug            String   @unique        // "abc-media" — dùng làm subdomain
  logoUrl         String?
  settings        Json?                   // Tùy chỉnh: timezone, currency, language
  subscriptionTier SubscriptionTier @default(FREE)
  // FREE | STARTER | PRO | ENTERPRISE
  maxEmployees    Int      @default(10)
  maxChannels     Int      @default(20)
  status          TenantStatus @default(ACTIVE)
  createdAt       DateTime @default(now())
  
  employees       Employee[]
  departments     Department[]
  channels        Channel[]
  kpis            KPI[]
}

// 2. Employee (User) — nhân viên + tài khoản đăng nhập
model Employee {
  id            String   @id @default(cuid())
  tenantId      String
  email         String                    // Unique trong tenant, không global
  password      String                    // bcrypt
  fullName      String
  avatar        String?
  phone         String?
  position      String?                   // "Senior Editor", "Content Manager"
  role          EmployeeRole @default(STAFF)
  // SUPER_ADMIN (chỉ hệ thống) | TENANT_ADMIN | MANAGER | STAFF | VIEWER
  status        EmployeeStatus @default(ACTIVE)
  // ACTIVE | INACTIVE | TERMINATED
  joinDate      DateTime
  terminateDate DateTime?
  
  departmentId  String?
  department    Department? @relation(fields: [departmentId], references: [id])
  
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  ownedChannels ChannelOwnership[]
  kpis          KPI[]    @relation("EmployeeKPIs")
  assignedKPIs  KPI[]    @relation("KPIAssignedBy")
  
  @@unique([tenantId, email])
  @@index([tenantId, status])
}

// 3. Department — phòng ban
model Department {
  id          String   @id @default(cuid())
  tenantId    String
  name        String                      // "Marketing", "Tin tức", "Giải trí"
  description String?
  color       String?                     // Hex color cho UI
  managerId   String?                     // Trưởng phòng
  
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  employees   Employee[]
  
  @@unique([tenantId, name])
}

// 4. Channel — kênh truyền thông được khai báo
model Channel {
  id            String   @id @default(cuid())
  tenantId      String
  name          String                    // Tên hiển thị nội bộ
  platform      Platform
  // YOUTUBE | FACEBOOK | INSTAGRAM | TELEGRAM | WHATSAPP
  externalId    String                    // YouTube channelId, FB pageId, etc.
  externalUrl   String                    // Link công khai đến kênh
  description   String?
  category      String?                   // "Thời sự", "Giải trí", "Lifestyle"
  
  // Connection info — dùng cho sync
  accessToken   String?                   // Encrypted, nếu cần OAuth
  refreshToken  String?                   // Encrypted
  tokenExpiresAt DateTime?
  syncStatus    SyncStatus @default(PENDING)
  // PENDING | SYNCING | OK | ERROR | DISCONNECTED
  lastSyncAt    DateTime?
  lastSyncError String?
  
  status        ChannelStatus @default(ACTIVE)
  // ACTIVE | INACTIVE | ARCHIVED
  
  createdAt     DateTime @default(now())
  
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  ownerships    ChannelOwnership[]
  metrics       ChannelMetric[]
  kpis          KPI[]
  
  @@unique([tenantId, platform, externalId])
  @@index([tenantId, status])
}

// 5. ChannelOwnership — junction: ai phụ trách kênh nào
model ChannelOwnership {
  id          String   @id @default(cuid())
  channelId   String
  employeeId  String
  role        OwnershipRole @default(SECONDARY)
  // PRIMARY (chính, 1 người) | SECONDARY (hỗ trợ, nhiều người)
  assignedAt  DateTime @default(now())
  assignedBy  String                      // ID của người gán
  
  channel     Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  employee    Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  
  @@unique([channelId, employeeId])
  @@index([employeeId])
}

// 6. ChannelMetric — snapshot metrics theo ngày
model ChannelMetric {
  id              String   @id @default(cuid())
  channelId       String
  snapshotDate    DateTime @db.Date        // Mỗi ngày 1 snapshot
  
  // Universal metrics (tất cả platforms đều có)
  followers       Int      @default(0)     // Subscribers / Page likes / Members
  followersDelta  Int      @default(0)     // So với hôm trước
  
  // Performance metrics (chỉ platforms support)
  viewsTotal      BigInt?                  // Tổng lifetime views
  viewsPeriod     Int?                     // Views trong period (24h)
  watchTimeHours  Float?                   // YouTube only
  engagementRate  Float?                   // Facebook/Instagram
  impressions     Int?
  
  // Source tracking
  source          MetricSource @default(API)
  // API (auto-synced) | MANUAL (nhập tay)
  syncedAt        DateTime @default(now())
  
  channel         Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  
  @@unique([channelId, snapshotDate])
  @@index([channelId, snapshotDate(sort: Desc)])
}

// 7. KPI — chỉ tiêu giao
model KPI {
  id            String   @id @default(cuid())
  tenantId      String
  
  // Scope: theo kênh hoặc theo nhân viên
  scope         KPIScope
  // PER_CHANNEL | PER_EMPLOYEE
  channelId     String?                    // null nếu scope = PER_EMPLOYEE
  employeeId    String                     // Luôn có — KPI giao cho ai
  
  // Period
  periodType    PeriodType                 // MONTHLY | QUARTERLY | YEARLY
  periodStart   DateTime @db.Date
  periodEnd     DateTime @db.Date
  
  // Targets (tùy platform sẽ có/không có)
  targetFollowers      Int?
  targetFollowersGain  Int?               // Tăng trưởng follower trong period
  targetViews          Int?
  targetWatchTime      Float?
  targetEngagement     Float?
  
  // Calculated automatically
  achievementPercent   Float?              // 0-100+
  status               KPIStatus @default(IN_PROGRESS)
  // NOT_STARTED | IN_PROGRESS | ACHIEVED | EXCEEDED | MISSED
  
  // Audit
  assignedById  String
  assignedAt    DateTime @default(now())
  notes         String?
  
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  channel       Channel? @relation(fields: [channelId], references: [id])
  employee      Employee @relation("EmployeeKPIs", fields: [employeeId], references: [id])
  assignedBy    Employee @relation("KPIAssignedBy", fields: [assignedById], references: [id])
  
  @@index([tenantId, employeeId, periodStart])
  @@index([tenantId, channelId, periodStart])
}

// Enums tổng hợp
enum Platform { YOUTUBE FACEBOOK INSTAGRAM TELEGRAM WHATSAPP }
enum EmployeeRole { SUPER_ADMIN TENANT_ADMIN MANAGER STAFF VIEWER }
enum EmployeeStatus { ACTIVE INACTIVE TERMINATED }
enum ChannelStatus { ACTIVE INACTIVE ARCHIVED }
enum SyncStatus { PENDING SYNCING OK ERROR DISCONNECTED }
enum OwnershipRole { PRIMARY SECONDARY }
enum MetricSource { API MANUAL }
enum KPIScope { PER_CHANNEL PER_EMPLOYEE }
enum PeriodType { MONTHLY QUARTERLY YEARLY }
enum KPIStatus { NOT_STARTED IN_PROGRESS ACHIEVED EXCEEDED MISSED }
enum SubscriptionTier { FREE STARTER PRO ENTERPRISE }
enum TenantStatus { ACTIVE SUSPENDED CANCELLED }
```

---

## MULTI-TENANT ARCHITECTURE

### Quy tắc 1: Mọi query phải filter theo `tenantId`

Không bao giờ được query database mà không có `tenantId` filter, trừ trường hợp super admin maintenance.

### Quy tắc 2: Auto-injection qua Prisma Extension

```typescript
// /packages/db/tenant-extension.ts
import { Prisma } from '@prisma/client'

export function tenantExtension(getTenantId: () => string | null) {
  return Prisma.defineExtension({
    name: 'tenantFilter',
    query: {
      $allModels: {
        async findMany({ args, query }) {
          const tenantId = getTenantId()
          if (tenantId) {
            args.where = { ...args.where, tenantId }
          }
          return query(args)
        },
        async findFirst({ args, query }) { /* same logic */ },
        async create({ args, query }) {
          const tenantId = getTenantId()
          if (tenantId && !args.data.tenantId) {
            args.data = { ...args.data, tenantId }
          }
          return query(args)
        },
        // ... update, delete, count, etc.
      }
    }
  })
}
```

### Quy tắc 3: TenantId trong JWT

```typescript
// JWT payload
{
  userId: 'user-123',
  tenantId: 'tenant-abc',        // BẮT BUỘC
  role: 'TENANT_ADMIN',
  iat: 1714123456,
  exp: 1714209856
}
```

### Quy tắc 4: Subdomain routing (tùy chọn)

```
abc-media.tracker.com   → tenantId của ABC Media
xyz-news.tracker.com    → tenantId của XYZ News
admin.tracker.com       → Super admin panel (quản lý tất cả tenants)
```

---

## RBAC SYSTEM

### 5 cấp role

| Role          | Mô tả                                     | Quyền                                        |
|---------------|-------------------------------------------|----------------------------------------------|
| SUPER_ADMIN   | Owner của hệ thống (chỉ 1-2 người)        | Quản lý tất cả tenants, billing, system      |
| TENANT_ADMIN  | Owner của tenant (CEO/Founder của team)   | Toàn quyền trong tenant: thêm employee, channel |
| MANAGER       | Trưởng phòng / Team lead                  | Xem tất cả trong department mình, giao KPI   |
| STAFF         | Nhân viên thường                          | Xem channels mình phụ trách, KPI của mình    |
| VIEWER        | Khách / Stakeholder                       | Chỉ xem dashboard tổng quan                  |

### Permission matrix

| Module       | SUPER_ADMIN | TENANT_ADMIN | MANAGER       | STAFF         | VIEWER |
|--------------|-------------|--------------|---------------|---------------|--------|
| Tenants      | Full        | Self only    | –             | –             | –      |
| Employees    | All tenants | Tenant full  | Department    | Self          | –      |
| Departments  | Full        | Tenant full  | Read          | Read          | –      |
| Channels     | Full        | Tenant full  | Owned/Dept    | Owned only    | Read   |
| KPI          | Full        | Tenant full  | Department    | Self          | Read   |
| Metrics      | Full        | Tenant full  | Department    | Owned         | Read   |
| Analytics    | Full        | Tenant full  | Department    | Owned         | Read   |
| Reports      | Full        | Tenant full  | Department    | –             | –      |
| Integrations | Full        | Tenant full  | –             | –             | –      |

---

## SYNC STRATEGY — Mỗi 1 giờ

### Cron schedule

```typescript
// Mỗi giờ tròn (1:00, 2:00, ...): sync metrics tất cả active channels
@Cron('0 * * * *')
async hourlyMetricsSync() {
  // Lấy tất cả channels đang active, group theo platform
  // Đẩy vào BullMQ queue với rate limiting
}

// Mỗi ngày 7:00 sáng: full daily snapshot + tính KPI achievement
@Cron('0 7 * * *')
async dailyFullSnapshot() {
  // Snapshot full metrics
  // Recalculate tất cả KPI achievement %
}
```

### Quota management — quan trọng vì sync mỗi giờ

```
YouTube quota: 10,000 units/day
- channels.list = 1 unit
- channels.statistics = 1 unit
- analytics.query = 1 unit
- Total per channel per sync ≈ 3 units
- 24 syncs/day × 3 units = 72 units/channel/day
- Max channels per tenant = floor(10000 / 72) ≈ 138 channels

Facebook: 200 calls/hour/user
- 24 calls/day = OK cho cả nghìn channels

Instagram: shared với Facebook quota

Telegram Bot: 30 messages/sec → không phải issue

WhatsApp Business: 1000 conversations/day, không tốn cho read metrics
```

### Per-tenant quota tracking

```typescript
// Redis key: quota:tenant-{id}:{platform}:{date}
// Track để alert khi gần hết quota
```

---

## API PATTERNS

### Tenant context middleware (Next.js)

```typescript
// /apps/web/src/middleware.ts
import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function middleware(req) {
  const token = await getToken({ req })
  if (!token) return NextResponse.redirect('/login')
  
  // Resolve tenantId từ subdomain hoặc JWT
  const host = req.headers.get('host')
  const subdomain = host?.split('.')[0]
  
  // Verify tenant từ JWT match với subdomain
  if (subdomain !== 'admin' && token.tenantSlug !== subdomain) {
    return NextResponse.redirect('/access-denied')
  }
  
  // Inject tenant context vào request headers
  const response = NextResponse.next()
  response.headers.set('x-tenant-id', token.tenantId as string)
  return response
}
```

### Response format

```typescript
{ success: true, data: T, pagination?: { page, limit, total } }
{ success: false, error: string, code?: string }
```

---

## CODING CONVENTIONS

- TypeScript strict mode, không `any`
- camelCase variables, PascalCase components, kebab-case files
- API routes: `/api/v1/{resource}` với tenantId tự inject
- Comments: tiếng Việt cho business logic, tiếng Anh cho technical
- Error messages: tiếng Việt (hiển thị cho user)
- Mọi date format theo `Asia/Ho_Chi_Minh` cho display, UTC trong DB
- KHÔNG hardcode tenantId, luôn lấy từ context

---

## ENVIRONMENT VARIABLES

```env
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/hr_tracker"
REDIS_URL="redis://localhost:6379"

# Auth
NEXTAUTH_SECRET=""
NEXTAUTH_URL=""
ENCRYPTION_KEY=""              # 32 bytes hex cho encrypt tokens

# Multi-tenant
ROOT_DOMAIN="tracker.com"
ADMIN_SUBDOMAIN="admin"
ENABLE_SUBDOMAIN_ROUTING="true"

# Platforms
YOUTUBE_API_KEY=""             # API key cho public data
YOUTUBE_CLIENT_ID=""           # OAuth cho channel-specific data
YOUTUBE_CLIENT_SECRET=""

FACEBOOK_APP_ID=""
FACEBOOK_APP_SECRET=""

TELEGRAM_BOT_TOKEN=""          # Master bot token (1 bot dùng chung)

WHATSAPP_BUSINESS_ID=""
WHATSAPP_ACCESS_TOKEN=""

# Email
RESEND_API_KEY=""
EMAIL_FROM="noreply@tracker.com"

# Monitoring
SENTRY_DSN=""
```

---

## SKILLS REFERENCE

| Khi làm gì                  | Đọc file skill này              |
|-----------------------------|----------------------------------|
| Multi-tenant query/filter   | `multi-tenant-patterns.md`      |
| Sync metrics từ platform    | `metrics-sync-patterns.md`      |
| KPI calculation             | `kpi-calculation.md`            |
| API route                   | `api-patterns.md`               |
| RBAC permission             | `rbac-patterns.md`              |
| UI component                | `ui-components.md`              |

---

## CURRENT PHASE

**Phase hiện tại:** Refactor V2 — chuyển từ Media Ops sang HR + Channel Tracker

**Đã hoàn thành (V1 cũ, kế thừa):**
- [x] Auth + Login system
- [x] User + Role models
- [x] Dashboard layout
- [x] Mobile responsive + PWA
- [x] Sentry monitoring
- [x] Recharts visualizations

**Day 1 hoàn thành:** cleanup xong post creation, calendar, workflow, media, scheduler
- [x] Xóa /(dashboard)/calendar, /review, /media + components/calendar, /review, /posts
- [x] Xóa /api/v1/posts, /cross-posts, /calendar, /review-queue, analytics/channels/[id]/posts
- [x] Xóa apps/api/src/modules/{posts,media,scheduler}
- [x] Xóa post-publisher.worker, best-time.service
- [x] Xóa POST_PUBLISHER queue khỏi BullMQ — giữ analytics-sync, alert-checker, notification-sender
- [x] Đổi analytics sync cron sang EVERY_HOUR (V2 spec)
- [x] Strip Post-publish methods khỏi 5 platform services (meta/youtube/twitter/telegram/whatsapp) — giữ read-only sync
- [x] Strip alert detectors phụ thuộc Post/Task (CHANNEL_INACTIVE/SCHEDULED_POST_FAILED/DEADLINE_APPROACHING)
- [x] Comment Post/Task/CrossPostGroup/MediaLibrary/PostWorkflowHistory trong schema.prisma
- [x] Strip seedPosts/seedTasks khỏi seed.ts
- [x] Xóa S3/R2 env vars khỏi .env.example
- [x] Type-check sạch cả apps/web + apps/api

**Đang làm (Day 2+):**
- [ ] Refactor Channel module thành Channel Registry
- [ ] Build KPI module
- [ ] Multi-tenant architecture (Tenant model + Prisma extension + JWT tenantId)
- [ ] Per-employee dashboard
- [ ] Installer cho team khác

**Bước tiếp theo:**
Theo file REFACTOR_PROMPTS.md — Day 2: Channel Registry refactor

---

## KNOWN ISSUES

(Cập nhật khi phát hiện)

---

## INSTALLATION FOR NEW TEAMS

Xem file `INSTALL_GUIDE.md` ở root.

Quick start:
```bash
git clone <repo>
cd hr-channel-tracker
cp .env.example .env  # Điền vào config
docker-compose up -d
./scripts/setup-tenant.sh "Tên công ty" "admin@email.com"
```

---

*Cập nhật lần cuối: refactor v2 từ Media Ops sang HR + Channel Tracker*
