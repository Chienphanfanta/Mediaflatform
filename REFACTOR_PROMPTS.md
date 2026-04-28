# REFACTOR_PROMPTS.md — 7-Day Refactor V2

> **QUAN TRỌNG:** Trước khi bắt đầu, tạo branch mới:
> ```bash
> git checkout -b refactor/v2-hr-tracker
> git push -u origin refactor/v2-hr-tracker
> ```
> Mỗi ngày commit ít nhất 1 lần để có thể rollback nếu cần.

---

## DAY 0 — Setup môi trường refactor (30 phút)

### Prompt 0.1 — Replace CLAUDE.md với V2

```
Tôi đang chuyển đổi dự án từ "Media Ops Platform" (đăng bài đa kênh) sang "HR + Channel Performance Tracker" (HR + theo dõi tăng trưởng kênh, KHÔNG đăng bài).

Hãy thay thế hoàn toàn nội dung file CLAUDE.md ở root bằng nội dung tôi cung cấp dưới đây:

[PASTE TOÀN BỘ NỘI DUNG CLAUDE.md V2 VÀO ĐÂY]

Sau khi thay xong, đọc lại CLAUDE.md mới và tóm tắt cho tôi:
1. Sự khác biệt chính giữa V1 và V2
2. Những module nào trong V1 sẽ bị xóa
3. Những module mới nào sẽ được thêm
4. Multi-tenant architecture sẽ ảnh hưởng những file nào

Đừng thay đổi code khác trong dự án ở bước này — chỉ update CLAUDE.md để định hướng cho các bước tiếp theo.
```

### Prompt 0.2 — Tạo migration plan rõ ràng

```
Đọc CLAUDE.md (V2 mới) trước.

Hãy phân tích codebase hiện tại và tạo file MIGRATION_PLAN.md ở root với:

1. Liệt kê CỤ THỂ tên file/folder cần XÓA hoàn toàn (vd: /apps/web/src/app/(dashboard)/calendar/, /apps/api/src/modules/posts/...)
2. Liệt kê file cần REFACTOR và làm gì với chúng (vd: Channel module: bỏ post-related fields, thêm ownership)
3. Liệt kê file/folder MỚI cần tạo (vd: /apps/api/src/modules/kpi/, /packages/db/tenant-extension.ts)
4. Risk assessment: file nào risky cao (động đến database), file nào safe (chỉ UI)
5. Thứ tự refactor để không break dependencies (xóa từ leaf nodes lên trước)

KHÔNG xóa hay sửa gì ở bước này. Chỉ tạo plan để tôi review.
```

---

## DAY 1 — Cleanup code không cần (4-6 giờ)

### Prompt 1.1 — Xóa Post creation và Content Calendar

```
Đọc CLAUDE.md V2 + MIGRATION_PLAN.md trước.

Bắt đầu refactor — Xóa code KHÔNG dùng nữa, theo thứ tự an toàn:

1. Xóa toàn bộ folder /apps/web/src/app/(dashboard)/calendar/
2. Xóa toàn bộ folder /apps/web/src/components/calendar/
3. Xóa /apps/web/src/components/posts/ (form tạo bài, post editor, modal)
4. Xóa /apps/web/src/app/api/v1/posts/ (tất cả API routes liên quan tạo post)
5. Xóa references đến calendar/posts trong:
   - Sidebar navigation (/components/layout/sidebar.tsx)
   - Bottom nav mobile (/components/layout/bottom-nav.tsx)
   - Dashboard page (loại bỏ các widget liên quan posts)
6. Bỏ Post model trong prisma/schema.prisma (giữ tạm comment để tham khảo)
7. Xóa các React Query hooks: usePostsQuery, useCreatePost, useUpdatePost...

Sau khi xóa, chạy:
- npm run typecheck — fix tất cả type errors do imports bị break
- npm run build — đảm bảo build thành công
- npm run dev — verify app vẫn chạy được (dù thiếu chức năng cũ)

Báo cáo lại: bao nhiêu files đã xóa, có errors gì cần fix, có code nào còn reference đến Post model không.
```

### Prompt 1.2 — Xóa Approval Workflow + Cross-posting + Media Library

```
Đọc CLAUDE.md V2 trước.

Tiếp tục cleanup — Xóa các features không dùng nữa:

1. Approval Workflow:
   - Xóa /apps/web/src/app/(dashboard)/review/
   - Xóa /apps/api/src/modules/posts/workflow.service.ts (nếu có)
   - Xóa WorkflowHistory model trong schema.prisma
   - Xóa API routes /api/v1/posts/:id/workflow

2. Cross-posting:
   - Xóa /apps/api/src/modules/posts/cross-post.service.ts
   - Xóa CrossPostGroup model
   - Xóa UI cross-post modal trong calendar (đã xóa) và channels page

3. Media Library:
   - Xóa toàn bộ /apps/web/src/app/(dashboard)/media/
   - Xóa /apps/api/src/modules/media/
   - Xóa MediaLibrary model
   - Xóa upload service và Cloudflare R2 dependency
   - Bỏ NEXT_PUBLIC_R2_*, R2_* env vars trong .env.example

4. Best-time calculator:
   - Xóa hàm getBestPublishTime trong schedulerService

5. Cập nhật package.json: remove @aws-sdk/client-s3 (nếu có), papaparse (nếu chỉ dùng cho post export)

Verify lại bằng grep:
- grep -r "MediaLibrary" apps/ packages/ → phải = 0 results
- grep -r "WorkflowHistory" → 0 results
- grep -r "crossPost" → 0 results

Chạy build để verify không lỗi.
```

### Prompt 1.3 — Xóa Scheduler Service và Post Publisher Worker

```
Đọc CLAUDE.md V2 trước.

Hoàn tất cleanup — Xóa toàn bộ phần Scheduler/Auto-publish (vì V2 không đăng bài):

1. Xóa toàn bộ /apps/api/src/modules/queue/workers/post-publisher.worker.ts
2. Xóa /apps/api/src/modules/scheduler/ (nếu có folder riêng)
3. Trong /apps/api/src/modules/queue/queue.module.ts:
   - GIỮ queues: "analytics-sync", "alert-checker", "notification-sender"
   - XÓA queue: "post-publisher"

4. Xóa các cron jobs publish-related:
   - checkScheduledPosts() — xóa hoàn toàn
   - GIỮ analytics sync jobs (đổi schedule sang mỗi giờ thay vì 6h theo V2 spec)

5. Cleanup BullMQ jobs đang waiting trong Redis:
   ```bash
   # Trong Redis CLI hoặc qua Bull-board:
   # Empty queue post-publisher
   redis-cli FLUSHDB  # Hoặc selective delete
   ```

6. Bỏ các env vars liên quan publish: PLATFORM_PUBLISH_*, SCHEDULED_POST_BUFFER_MINUTES

7. Cập nhật CLAUDE.md V2 — section CURRENT PHASE: ghi "Day 1 hoàn thành: cleanup xong post creation, calendar, workflow, media, scheduler"

Cuối ngày: commit "refactor: cleanup post creation and publishing features"
git push.
```

---

## DAY 2 — Refactor Channel thành Channel Registry (4-6 giờ)

### Prompt 2.1 — Sửa Channel model + ChannelOwnership

```
Đọc CLAUDE.md V2 + .claude/skills/database-queries.md trước.

Refactor Channel module thành Channel Registry (read-only monitoring):

1. Cập nhật prisma/schema.prisma:
   - Channel model: 
     * GIỮ: id, name, platform, externalId, externalUrl, status, accessToken, refreshToken, syncStatus, lastSyncAt
     * THÊM: tenantId (string, required), description, category (string optional), lastSyncError
     * BỎ: ownerId (single field) — vì giờ là many-to-many qua ChannelOwnership
     * Đổi: status enum thành { ACTIVE, INACTIVE, ARCHIVED } (bỏ các status liên quan post)
   
   - Tạo model ChannelOwnership:
     id, channelId, employeeId, role (PRIMARY|SECONDARY), assignedAt, assignedBy
     Relations: cascade delete khi xóa channel hoặc employee
   
   - Bỏ Post model hoàn toàn nếu vẫn còn

2. Tạo migration:
   npx prisma migrate dev --name refactor_channels_v2

3. Update seed.ts:
   - Tạo 5 channels mẫu trên các platforms khác nhau
   - Tạo ChannelOwnership: 2-3 channels có PRIMARY owner + 1 SECONDARY owner

4. Refactor /apps/api/src/modules/channels/:
   - channels.service.ts:
     * findAll(tenantId, filters) — chỉ trả channels của tenant
     * findOne(channelId) — kèm ownerships, metrics gần nhất
     * create(data, currentUserId) — tự gắn tenantId từ context
     * assignOwner(channelId, employeeId, role) — thêm ownership
     * removeOwner(channelId, employeeId) — xóa ownership
     * transferPrimaryOwnership(channelId, fromEmployeeId, toEmployeeId)

5. API routes /api/v1/channels:
   GET /, GET /:id, POST /, PUT /:id, DELETE /:id
   POST /:id/owners — body: { employeeId, role }
   DELETE /:id/owners/:employeeId
   POST /:id/transfer-primary — body: { newPrimaryEmployeeId }

Test với Postman hoặc Thunder Client. Đảm bảo tenantId tự động được filter.
```

### Prompt 2.2 — Channel Registry UI mới

```
Đọc CLAUDE.md V2 + .claude/skills/ui-components.md trước.

Refactor trang /apps/web/src/app/(dashboard)/channels/:

1. /channels/page.tsx — Danh sách kênh:
   
   FILTER BAR (top):
   - Search by name/url
   - Filter by platform (multi-select badges)
   - Filter by department (dropdown)
   - Filter by primary owner (dropdown)
   - Filter by status: All / Active / Inactive / Archived
   - View toggle: Grid view (cards) / List view (table)

   CARD GRID (default):
   Mỗi channel = 1 card với:
   - Header: Platform icon + tên kênh + status badge
   - Body: 
     * Avatar/thumbnail từ platform
     * Subscriber/Follower count + delta tuần này
     * Primary owner: avatar + tên (click → trang nhân viên)
     * Secondary owners: avatar group (max 3, +N nếu nhiều hơn)
     * Department badge với color
   - Footer: 
     * Last sync time
     * Sync status indicator (xanh/vàng/đỏ)
     * Nút "Chi tiết" + Menu (...) với: Sync ngay, Edit, Archive, Transfer

   THÊM KÊNH MỚI button (top right, MANAGER+):
   - Modal multi-step:
     Step 1: Chọn platform
     Step 2: Nhập thông tin kênh (name, externalId/url, category, description)
     Step 3: Gán PRIMARY owner (bắt buộc) + SECONDARY owners (optional)
     Step 4: Connect API (OAuth flow hoặc API key tùy platform)
     Step 5: Test connection → Lưu

2. /channels/[id]/page.tsx — Chi tiết kênh:
   
   HEADER:
   - Tên + platform badge + status
   - Owner info: primary + secondaries
   - Department + category
   - External URL (mở tab mới)
   - Action buttons: Sync now, Edit, Archive
   
   TABS:
   - Tab "Tổng quan": Stats hiện tại + chart 30 ngày
   - Tab "Tăng trưởng": Charts followers/views theo thời gian
   - Tab "KPI": KPIs đã giao cho kênh này + achievement
   - Tab "Lịch sử owners": Ai đã từng phụ trách kênh này
   - Tab "Sync logs": Lần sync gần nhất + errors

Dùng React Query với staleTime 2 phút. Skeleton loading.
```

### Prompt 2.3 — Cập nhật sidebar + permissions

```
Đọc CLAUDE.md V2 trước.

Update navigation và permissions cho Channel Registry:

1. /components/layout/sidebar.tsx — Sidebar mới với menu items:
   - Dashboard (/)
   - Nhân sự (/employees) — icon: Users
   - Phòng ban (/departments) — icon: Building2  
   - Kênh truyền thông (/channels) — icon: Radio
   - KPI (/kpi) — icon: Target
   - Tăng trưởng (/analytics) — icon: TrendingUp
   - Báo cáo (/reports) — icon: FileText
   - Cài đặt (/settings) — icon: Settings (chỉ TENANT_ADMIN)
   
   BỎ các menu cũ: Calendar, Review, Media

2. /components/layout/bottom-nav.tsx (mobile) — 5 tabs:
   - Dashboard | Nhân sự | Kênh | KPI | Menu

3. Update RBAC permissions trong /lib/rbac.ts:
   ```typescript
   const PERMISSIONS = {
     SUPER_ADMIN: { /* full access tất cả tenants */ },
     TENANT_ADMIN: {
       employees: ['FULL'], departments: ['FULL'],
       channels: ['FULL'], kpi: ['FULL'],
       analytics: ['READ'], reports: ['READ'],
       settings: ['FULL']
     },
     MANAGER: {
       employees: ['READ', 'UPDATE'], departments: ['READ'],
       channels: ['READ', 'UPDATE'], kpi: ['CREATE', 'READ', 'UPDATE'],
       analytics: ['READ'], reports: ['READ']
     },
     STAFF: {
       channels: ['READ'], // Chỉ channels được assign
       kpi: ['READ'], // Chỉ của bản thân
       analytics: ['READ']
     },
     VIEWER: {
       analytics: ['READ'], reports: ['READ']
     }
   }
   ```

4. Component PermissionGate trong sidebar — ẩn menu items theo role.

5. Test login với 5 role khác nhau, verify menu hiển thị đúng.

Commit: "refactor: channel registry UI + new navigation"
```

---

## DAY 3 — Build KPI Module (5-7 giờ)

### Prompt 3.1 — KPI Schema + Service

```
Đọc CLAUDE.md V2 + .claude/skills/database-queries.md trước.

Build KPI module từ đầu (đây là feature mới):

1. Cập nhật prisma/schema.prisma — thêm KPI model như spec trong CLAUDE.md V2.

2. Migration:
   npx prisma migrate dev --name add_kpi_module

3. /apps/api/src/modules/kpi/kpi.service.ts với các methods:

   createKPI(data: {
     scope: 'PER_CHANNEL' | 'PER_EMPLOYEE',
     channelId?: string,
     employeeId: string,
     periodType: 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
     periodStart: Date,
     targetFollowers?, targetFollowersGain?,
     targetViews?, targetWatchTime?, targetEngagement?
   })
   
   bulkAssignKPI(employeeIds: string[], targets: {...}) 
   // Giao cùng KPI cho nhiều nhân viên
   
   recalculateAchievement(kpiId: string)
   // Tính lại achievement % dựa trên ChannelMetric mới nhất
   // Logic:
   //   - Nếu PER_CHANNEL: lấy metrics của channel đó trong period
   //   - Nếu PER_EMPLOYEE: SUM metrics của tất cả channels mà employee này là owner trong period
   //   - achievement = (actual / target) * 100
   //   - status = ACHIEVED nếu >= 100, EXCEEDED nếu >= 120, MISSED nếu period ended < 100
   
   recalculateAllForTenant(tenantId: string)
   // Chạy mỗi ngày lúc 7h sáng cho all KPIs của tenant
   
   getEmployeeKPISummary(employeeId: string, period?)
   // Tổng hợp KPI của 1 nhân viên: tất cả KPI active + achievement
   
   getChannelKPISummary(channelId: string, period?)
   // Tổng hợp KPI của 1 kênh

4. API routes /api/v1/kpi:
   GET    /         — list KPIs với filter (employeeId, channelId, period, status)
   POST   /         — tạo KPI mới
   POST   /bulk     — bulk assign
   GET    /:id      — chi tiết
   PUT    /:id      — update target
   DELETE /:id      — xóa
   POST   /:id/recalculate — manual trigger recalc
   GET    /summary/employee/:id  — summary của 1 nhân viên
   GET    /summary/channel/:id   — summary của 1 kênh
   GET    /summary/department/:id — summary cả phòng ban

5. Cron job mới — mỗi ngày 7h sáng:
   @Cron('0 7 * * *')
   async dailyKPIRecalculation() {
     // Loop tất cả tenants active
     // Recalculate tất cả KPIs IN_PROGRESS
   }

Test bằng Postman với data seed.
```

### Prompt 3.2 — KPI Skill file

```
Đọc CLAUDE.md V2 trước.

Tạo file .claude/skills/kpi-calculation.md với:

1. KPI Scope explanation:
   - PER_CHANNEL: target gắn với 1 kênh cụ thể
   - PER_EMPLOYEE: target tổng của nhân viên (sum tất cả channels phụ trách)

2. Achievement calculation formulas:
   ```typescript
   // Cho từng metric (followers, views, watch time, engagement):
   actualValue = await getActualMetric(scope, period)
   achievement = (actualValue / targetValue) * 100
   
   // Tổng hợp khi có nhiều metrics:
   // Cách 1 (đơn giản): Average of all achievements
   // Cách 2 (weighted): Tự định nghĩa weight cho từng metric
   
   // Cho PER_EMPLOYEE với multiple channels:
   actualViews = SUM(metrics.viewsPeriod) WHERE 
     channel IN (employee's owned channels) 
     AND date BETWEEN periodStart AND periodEnd
   ```

3. Status determination logic:
   - NOT_STARTED: period chưa bắt đầu
   - IN_PROGRESS: đang trong period, achievement < 100%
   - ACHIEVED: 100% <= achievement < 120%
   - EXCEEDED: achievement >= 120%
   - MISSED: period đã kết thúc, achievement < 100%

4. Period calculation helpers:
   ```typescript
   getMonthlyPeriod(year, month) → { start, end }
   getQuarterlyPeriod(year, quarter) → { start, end }
   getCurrentPeriod(periodType) → period hiện tại
   ```

5. Edge cases:
   - Nhân viên mới join giữa period: prorate target?
   - Channel transfer ownership giữa period: count cho ai?
   - KPI bị edit target sau khi đã chạy: recalc all

6. Performance optimization:
   - Cache achievement % trong KPI table (recalc khi có metrics mới)
   - Index: (tenantId, employeeId, periodStart) cho list queries
```

### Prompt 3.3 — KPI UI

```
Đọc CLAUDE.md V2 + .claude/skills/ui-components.md + .claude/skills/kpi-calculation.md trước.

Build KPI UI:

1. /apps/web/src/app/(dashboard)/kpi/page.tsx — KPI Overview:

   FILTER BAR:
   - Period selector (tháng này / quý này / năm này / custom)
   - Filter by department
   - Filter by status (All / In Progress / Achieved / Missed)
   - Toggle: View by Employee / View by Channel

   VIEW BY EMPLOYEE (default):
   Grid cards, mỗi nhân viên 1 card:
   - Avatar + tên + position
   - Số channels phụ trách
   - Progress bar tổng (average của các KPI của họ)
   - Top 3 KPIs với mini progress
   - Click card → /kpi/employee/[id]

   VIEW BY CHANNEL:
   Tương tự nhưng theo kênh.

2. /apps/web/src/app/(dashboard)/kpi/assign/page.tsx — Form giao KPI:

   3 modes (radio button đầu trang):
   ◉ Single Employee KPI
   ○ Single Channel KPI
   ○ Bulk Assign

   Form fields:
   - Period type: Monthly | Quarterly | Yearly
   - Period start: date picker (auto-fill end)
   - Targets section (collapsible per metric):
     * Followers gain: input number
     * Total views: input number
     * Watch time (hours): input (chỉ YouTube)
     * Engagement rate (%): input (chỉ FB/IG)
   - Notes textarea

   Preview panel bên phải:
   - Mock card hiển thị KPI sẽ trông như thế nào
   - Estimate achievement dựa trên historical data: "Dựa vào 3 tháng qua, KPI này có khả năng X% achieved"

   Submit button → save → toast success → redirect /kpi

3. /apps/web/src/app/(dashboard)/kpi/employee/[id]/page.tsx — Chi tiết KPI 1 nhân viên:

   - Header: avatar nhân viên + position + department
   - List KPIs hiện tại (active period):
     Mỗi KPI card với:
     * Period
     * Targets vs Actual (table)
     * Progress bars cho từng metric
     * Achievement % với badge color
     * Days remaining
   - Historical KPIs: bảng các period trước với status

4. Component KPIProgressBar:
   - Hiển thị target vs actual
   - Color coding: đỏ (<70%), vàng (70-99%), xanh lá (100-120%), xanh dương (>120%)
   - Tooltip với chi tiết khi hover

Test với KPI seed data.
```

---

## DAY 4 — Per-Employee Dashboard (4-5 giờ)

### Prompt 4.1 — Employee List + Detail Page

```
Đọc CLAUDE.md V2 + .claude/skills/ui-components.md trước.

Build trang Nhân sự đầy đủ:

1. /apps/web/src/app/(dashboard)/employees/page.tsx — Danh sách nhân viên:

   FILTER BAR:
   - Search by name/email/phone
   - Filter by department (dropdown)
   - Filter by role (multi-select)
   - Filter by status (Active/Inactive/Terminated)
   - Sort: Name | Join date | Department | Channels count

   TABLE VIEW (default desktop) / CARD VIEW (mobile):
   Columns: Avatar | Name | Position | Department | Role | Channels managed | KPI status | Status | Actions
   
   CHANNELS MANAGED column:
   - Hiển thị: "5 channels" với platform icons mini (YT, FB, IG...)
   - Tooltip on hover: list channel names
   
   KPI STATUS column:
   - Badge với % average achievement của tất cả KPIs active
   - Color theo status

   TOP RIGHT BUTTONS:
   - "+ Thêm nhân viên" (TENANT_ADMIN+)
   - Export CSV
   - Bulk import (modal với CSV upload + preview)

2. /apps/web/src/app/(dashboard)/employees/[id]/page.tsx — Per-Employee Dashboard:

   HEADER (sticky):
   - Avatar lớn + tên + position
   - Department badge
   - Role badge
   - Status badge
   - Buttons: Edit, Reset Password, Deactivate, Send Message
   - Quick stats: X channels | Y KPIs active | Join date

   MAIN CONTENT — 4 Tabs:

   TAB 1 — TỔNG QUAN:
   - Card "Channels phụ trách": list với metrics gần nhất
   - Card "KPI Performance": summary tháng này
   - Card "Trending": tăng trưởng 30 ngày qua
   - Recent activity timeline (login, channel updates, KPI updates)

   TAB 2 — KÊNH (Channels):
   - Grid cards của từng channel mà nhân viên phụ trách
   - Phân biệt PRIMARY (border đậm) vs SECONDARY (border nhạt)
   - Mini chart tăng trưởng cho mỗi channel
   - Click → navigate /channels/[id]

   TAB 3 — KPI:
   - Period selector
   - List KPIs active (channel-level + employee-level)
   - Historical KPIs với status

   TAB 4 — TĂNG TRƯỞNG (Analytics):
   - Combined chart: tổng followers/views của tất cả channels nhân viên phụ trách
   - Breakdown by platform (donut chart)
   - Top performing channel của nhân viên này
   - So sánh với tháng trước

3. Modal "Thêm nhân viên":
   - Multi-step:
     Step 1: Thông tin cá nhân (name, email, phone, position, avatar upload)
     Step 2: Phòng ban + Role
     Step 3: Assign channels (optional, có thể skip)
     Step 4: Set initial password + send welcome email
   - Validation: email unique trong tenant

4. Modal "Edit nhân viên": tương tự nhưng pre-filled, có thêm option "Transfer all channels to..."

Test trên cả desktop + mobile.
```

### Prompt 4.2 — Department module

```
Đọc CLAUDE.md V2 trước.

Build Department module (đơn giản, chủ yếu CRUD):

1. /apps/web/src/app/(dashboard)/departments/page.tsx:
   - Card grid mỗi department
   - Mỗi card: tên, color, manager (avatar), số nhân viên, số channels
   - Click card → expand list nhân viên + channels của dept
   - Buttons: Edit, Delete (chỉ nếu không có nhân viên)
   - "+ Thêm phòng ban" button

2. API routes /api/v1/departments:
   GET, POST, PUT, DELETE chuẩn
   GET /:id/employees — list nhân viên
   GET /:id/channels — list channels (qua employees)
   GET /:id/summary — tổng metrics phòng ban

3. Department analytics card trong dashboard tổng:
   - Compare departments (bar chart): tổng followers, views, KPI achievement
   - Drill down click → /departments/[id]/analytics

4. Validation:
   - Không thể xóa department có nhân viên — phải transfer trước
   - Manager phải là employee trong department đó

Commit: "feat: per-employee dashboard + department module"
```

---

## DAY 5 — Telegram Bot + WhatsApp Business + Manual Input (4-5 giờ)

### Prompt 5.1 — Telegram Bot Integration

```
Đọc CLAUDE.md V2 + .claude/skills/platform-integrations.md trước.

Tích hợp Telegram Bot API để track member count + post views:

1. /apps/api/src/modules/platforms/telegram/telegram.service.ts:

   Sử dụng MASTER bot token (1 bot dùng chung cho cả hệ thống — admin tạo qua @BotFather):

   methods:
   - syncChannelMetrics(channelId)
     1. getChat({ chat_id: externalId }) → tên, mô tả, photo
     2. getChatMembersCount({ chat_id: externalId }) → member count
     3. getChatAdministrators → check bot có phải admin không
     Nếu bot KHÔNG phải admin → set syncStatus = ERROR với message "Hãy thêm bot làm admin của channel"
     Lưu metric: followers = memberCount
   
   - verifyBotAccess(externalId) → kiểm tra bot có access không
   
   - getRecentMessages(externalId, limit=10) — không dùng được do Telegram restrictions, skip
   
   - getChannelInfo(channelOrUsername) — resolve username → chatId

2. UI Connect Telegram (trong modal Thêm channel hoặc Settings):
   
   Hướng dẫn user:
   "Để kết nối Telegram channel:
   1. Mở Telegram, search @YourBotName (bot của hệ thống)
   2. Thêm bot này làm Administrator của channel của bạn
   3. Bot cần quyền: Post messages, View members
   4. Quay lại đây và nhập @username hoặc invite link của channel
   5. Bấm 'Verify' để test connection"

   Form: input @username hoặc t.me/+xxx → Verify button → hiển thị tên + member count + xác nhận đúng channel

3. Cron job mỗi giờ:
   Thêm vào hourlyMetricsSync(): query tất cả Telegram channels active → sync.

4. Error handling:
   - Bot bị remove khỏi channel: syncStatus = DISCONNECTED, alert admin
   - Channel không tồn tại: status = ARCHIVED
   - Rate limit (30 msg/sec): dùng p-limit với 5 concurrent

5. Lưu Bot Token trong env: TELEGRAM_BOT_TOKEN (không phải per-tenant — dùng chung).

Test với 1 Telegram channel test thật.
```

### Prompt 5.2 — WhatsApp Business API Integration

```
Đọc CLAUDE.md V2 + .claude/skills/platform-integrations.md trước.

Tích hợp WhatsApp Business API:

LƯU Ý: WhatsApp Business API cho Groups KHÔNG có endpoint metrics chính thức. Chỉ track được Business Accounts (số phone đăng ký) + broadcast lists.

Implementation realistic:

1. /apps/api/src/modules/platforms/whatsapp/whatsapp.service.ts:

   Sử dụng Meta Graph API v18 với WhatsApp Business permission:
   
   methods:
   - syncBusinessAccount(channelId)
     GET /{phone-number-id}/whatsapp_business_profile
     Lấy: name, vertical, description, profile_picture_url
   
   - getMessageStats(channelId, date) — chỉ available cho conversation metrics, không phải member count
   
   - manualMemberCountUpdate(channelId, count, sourceUrl?) 
     Cho phép admin nhập tay member count (vì group chat không có API)
     Lưu với source = MANUAL trong ChannelMetric

2. Bảo trợ user về limitations:
   Khi tạo WhatsApp channel, hiển thị thông báo:
   "⚠ WhatsApp Business API có giới hạn:
   - Group chats: PHẢI nhập member count manually mỗi tuần
   - Business Accounts: Auto-sync profile và conversation stats
   - Broadcast: Track delivery + read rates
   Bạn muốn tracking loại nào?"
   
   Choice:
   ◉ WhatsApp Business Account (auto-sync)
   ○ Group Chat (manual entry only)
   ○ Broadcast list (auto-sync delivery)

3. Cho Group Chats — Manual entry UI:
   Trong /channels/[id]/page.tsx của WhatsApp Group channel:
   - Prominent button "📊 Cập nhật member count"
   - Modal: Input số thành viên hiện tại + Date + Optional screenshot
   - Save → tạo ChannelMetric với source=MANUAL
   - Reminder: alert mỗi tuần nếu không update

4. Cron job:
   - Auto-sync WhatsApp Business Accounts mỗi giờ
   - Reminder send: nếu Group Chat không update > 7 ngày → notify primary owner
```

### Prompt 5.3 — Manual Input + History UI

```
Đọc CLAUDE.md V2 trước.

Build UI cho Manual Metric Entry (cho channels không có API hoặc backup data):

1. Component <ManualMetricEntryModal> (/components/channels/manual-metric-modal.tsx):
   
   Trigger: Button trong channel detail page
   
   Form:
   - Snapshot date (date picker, default today)
   - Followers / Subscribers / Members (number)
   - Views (optional, cho YouTube/Facebook)
   - Watch time hours (optional, YouTube)
   - Engagement rate (optional)
   - Source/Notes (textarea — vd: "From Creator Studio screenshot 2024-04-26")
   - Optional: upload screenshot làm proof
   
   Save → POST /api/v1/channels/:id/metrics với source=MANUAL

2. API route POST /api/v1/channels/:id/metrics:
   - Permission: PRIMARY owner hoặc MANAGER+
   - Validate: snapshotDate không > today
   - Upsert: nếu đã có metric ngày đó → update; nếu chưa → create
   - Log: ai nhập, lúc nào (audit trail)

3. Component <MetricHistoryTable> trong channel detail:
   Bảng tất cả metrics, columns:
   Date | Followers | Views | Source (badge: API/MANUAL) | Updated by | Actions
   
   Filter: by source, date range
   Edit/Delete chỉ với MANUAL entries (API entries read-only)

4. Bulk import từ CSV:
   - Button "Import từ CSV" trong channel detail
   - Modal với CSV upload + template download
   - Template: date,followers,views,watch_time
   - Preview data trước khi import
   - Validate duplicates với existing metrics

Commit: "feat: telegram bot + whatsapp business + manual input"
```

---

## DAY 6 — Multi-tenant Architecture (5-6 giờ)

### Prompt 6.1 — Tenant Schema + Prisma Extension

```
Đọc CLAUDE.md V2 trước.

Build multi-tenant foundation:

1. Cập nhật prisma/schema.prisma:
   - Thêm Tenant model như spec
   - Thêm tenantId BẮT BUỘC vào TẤT CẢ models: Employee, Department, Channel, KPI, ChannelMetric (qua channel), ChannelOwnership (qua channel)
   - Indexes: (tenantId, ...) cho mọi unique và search-frequent fields
   - Unique constraints scope theo tenant: vd email unique trong tenant chứ không global

2. Migration:
   npx prisma migrate dev --name add_multi_tenant
   
   Vì có data hiện tại không có tenantId → tạo migration script:
   - Tạo 1 default tenant "Tenant gốc"
   - Update tất cả existing records gán về default tenant này

3. Tạo /packages/db/tenant-extension.ts:
   ```typescript
   import { Prisma } from '@prisma/client'
   
   export interface TenantContext {
     getTenantId: () => string | null
     isSuperAdmin: () => boolean
   }
   
   export function tenantExtension(ctx: TenantContext) {
     return Prisma.defineExtension({
       name: 'tenantFilter',
       query: {
         $allModels: {
           // findMany, findFirst, findUnique
           async $allOperations({ model, operation, args, query }) {
             // Skip cho Tenant model (root)
             if (model === 'Tenant') return query(args)
             
             // Skip nếu super admin
             if (ctx.isSuperAdmin()) return query(args)
             
             const tenantId = ctx.getTenantId()
             if (!tenantId) {
               throw new Error('No tenant context — refusing query')
             }
             
             // For read operations: inject where.tenantId
             if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate'].includes(operation)) {
               args.where = { ...args.where, tenantId }
             }
             
             // For write: inject data.tenantId for create
             if (['create', 'createMany'].includes(operation)) {
               if (Array.isArray(args.data)) {
                 args.data = args.data.map(d => ({ ...d, tenantId }))
               } else {
                 args.data = { ...args.data, tenantId }
               }
             }
             
             // For update/delete: ensure tenantId in where
             if (['update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
               args.where = { ...args.where, tenantId }
             }
             
             return query(args)
           }
         }
       }
     })
   }
   ```

4. Tenant context middleware NestJS:
   /apps/api/src/common/tenant/tenant.middleware.ts:
   - Extract tenantId từ JWT
   - Attach vào request: req.tenantId
   - Skip cho /api/v1/admin/* (super admin only)

5. Per-request Prisma client:
   /apps/api/src/common/tenant/tenant-prisma.service.ts:
   - Tạo Prisma client cho mỗi request với tenant context của request đó
   - Nếu super admin → skip extension

Test: Login as 2 tenants khác nhau, verify data hoàn toàn isolated.
```

### Prompt 6.2 — Tenant Auth + Subdomain Routing

```
Đọc CLAUDE.md V2 trước.

Build tenant-aware authentication:

1. Tenant signup flow (/app/(auth)/signup/page.tsx):
   Form 2 phần:
   - Company info: name, slug (auto-generate từ name, validate unique)
   - Admin user: name, email, password
   
   Submit → 
   - Tạo Tenant record
   - Tạo Employee đầu tiên với role=TENANT_ADMIN
   - Auto-login → redirect đến {slug}.tracker.com/dashboard
   - Send welcome email

2. Update NextAuth callback để include tenantId:
   - authorize(): tìm employee by email VÀ tenant slug (từ subdomain hoặc dropdown)
   - jwt callback: include tenantId, tenantSlug, role vào token
   - session callback: expose tenantId trong session

3. Subdomain routing (Next.js middleware):
   /apps/web/src/middleware.ts:
   ```typescript
   import { NextResponse } from 'next/server'
   import { getToken } from 'next-auth/jwt'
   
   const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'localhost:3000'
   
   export async function middleware(req) {
     const host = req.headers.get('host')!
     const subdomain = host.split('.')[0]
     
     // Admin subdomain → super admin only
     if (subdomain === 'admin') {
       const token = await getToken({ req })
       if (!token || token.role !== 'SUPER_ADMIN') {
         return NextResponse.redirect(new URL('/login', req.url))
       }
       return NextResponse.next()
     }
     
     // Root domain → landing page (public)
     if (host === ROOT_DOMAIN || subdomain === 'www') {
       return NextResponse.next()
     }
     
     // Tenant subdomain → verify tenant exists
     const tenant = await fetch(`/api/v1/tenants/by-slug/${subdomain}`)
     if (!tenant.ok) {
       return NextResponse.redirect(new URL('/tenant-not-found', req.url))
     }
     
     // For protected routes, verify token tenantSlug matches
     const token = await getToken({ req })
     if (token && token.tenantSlug !== subdomain) {
       return NextResponse.redirect(new URL('/login?wrong_tenant=1', req.url))
     }
     
     return NextResponse.next()
   }
   ```

4. Local development hỗ trợ subdomain:
   - Sửa /etc/hosts: thêm "127.0.0.1 abc.localhost xyz.localhost admin.localhost"
   - Hoặc dùng *.localtest.me (built-in)
   - Update .env: ROOT_DOMAIN=localhost:3000

5. Super Admin panel:
   /apps/web/src/app/admin/ — chỉ truy cập từ admin.tracker.com
   Trang quản lý tất cả tenants:
   - List tenants với metrics: # employees, # channels, last activity
   - Suspend/Activate tenant
   - Change subscription tier
   - View tenant details (read-only impersonate)

Test: 
- Tạo 2 tenants
- Login từng tenant subdomain riêng
- Verify không thấy data tenant khác
- Login admin → thấy cả 2 tenants
```

### Prompt 6.3 — Tenant Settings + Subscription Tiers

```
Đọc CLAUDE.md V2 trước.

Build tenant-level settings và subscription:

1. /app/(dashboard)/settings/tenant/page.tsx (TENANT_ADMIN only):
   
   TAB "Thông tin công ty":
   - Logo upload
   - Tên công ty
   - Slug (read-only sau khi tạo, contact support để đổi)
   - Timezone (default Asia/Ho_Chi_Minh)
   - Language (vi / en)
   - Currency (VND / USD)
   
   TAB "Subscription":
   - Current plan badge
   - Usage stats: X/Y employees, X/Y channels
   - Upgrade/Downgrade buttons
   - Invoice history (placeholder, future)
   
   TAB "Danh sách Admins":
   - List tất cả TENANT_ADMIN users
   - Promote/demote employees
   
   TAB "Tích hợp Platform":
   - Cấu hình OAuth credentials cho tenant (nếu họ muốn dùng riêng)
   - Hoặc dùng shared credentials của hệ thống (default)
   
   TAB "Danger Zone":
   - Export all data
   - Delete tenant (require typing tenant name confirmation)

2. Subscription tier limits (enforce trong code):
   ```typescript
   const TIER_LIMITS = {
     FREE:       { maxEmployees: 5,   maxChannels: 10,  syncFrequency: '6h', historicalDays: 30 },
     STARTER:    { maxEmployees: 20,  maxChannels: 50,  syncFrequency: '1h', historicalDays: 90 },
     PRO:        { maxEmployees: 100, maxChannels: 500, syncFrequency: '1h', historicalDays: 365 },
     ENTERPRISE: { maxEmployees: -1,  maxChannels: -1,  syncFrequency: '15m', historicalDays: -1 }
   }
   ```
   
   Check khi: tạo employee mới, thêm channel, etc.
   Show upgrade prompt khi gần limit (90% used).

3. Subscription enforcement decorator:
   ```typescript
   @CheckLimit('maxChannels')
   async createChannel(...) { ... }
   ```

4. Data export feature:
   POST /api/v1/tenants/me/export
   - Background job tạo ZIP file: employees.csv, channels.csv, metrics.csv, kpis.csv
   - Email link download khi xong (link expire 24h)

Commit: "feat: multi-tenant architecture + subscription tiers"
```

---

## DAY 7 — Installer + Documentation (3-4 giờ)

### Prompt 7.1 — Docker setup + Installer script

```
Đọc CLAUDE.md V2 trước.

Build 1-command installer cho team khác:

1. /docker-compose.yml ở root:
   ```yaml
   version: '3.8'
   services:
     postgres:
       image: postgres:15-alpine
       restart: unless-stopped
       environment:
         POSTGRES_USER: ${DB_USER:-tracker}
         POSTGRES_PASSWORD: ${DB_PASSWORD}
         POSTGRES_DB: ${DB_NAME:-hr_tracker}
       volumes:
         - postgres_data:/var/lib/postgresql/data
       healthcheck:
         test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-tracker}"]
         interval: 10s
   
     redis:
       image: redis:7-alpine
       restart: unless-stopped
       volumes:
         - redis_data:/data
   
     web:
       build:
         context: .
         dockerfile: apps/web/Dockerfile
       restart: unless-stopped
       ports:
         - "3000:3000"
       environment:
         DATABASE_URL: postgresql://${DB_USER:-tracker}:${DB_PASSWORD}@postgres:5432/${DB_NAME:-hr_tracker}
         REDIS_URL: redis://redis:6379
         NEXTAUTH_URL: ${NEXTAUTH_URL}
         NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
         ENCRYPTION_KEY: ${ENCRYPTION_KEY}
       depends_on:
         postgres:
           condition: service_healthy
   
     api:
       build:
         context: .
         dockerfile: apps/api/Dockerfile
       restart: unless-stopped
       ports:
         - "3001:3001"
       environment:
         # ... cùng vars + platform tokens
       depends_on:
         postgres:
           condition: service_healthy
         redis:
           condition: service_started
   
     worker:
       build:
         context: .
         dockerfile: apps/api/Dockerfile
       command: node dist/worker
       restart: unless-stopped
       environment:
         # ... cùng vars
       depends_on:
         - api
   
   volumes:
     postgres_data:
     redis_data:
   ```

2. /scripts/setup.sh — interactive installer:
   ```bash
   #!/bin/bash
   set -e
   
   echo "🚀 HR + Channel Tracker Installer"
   echo "================================="
   
   # Check prerequisites
   command -v docker >/dev/null 2>&1 || { echo "Docker chưa cài. Cài tại docker.com"; exit 1; }
   
   # Generate secrets if .env doesn't exist
   if [ ! -f .env ]; then
     echo "📝 Tạo file .env mới..."
     cp .env.example .env
     
     # Auto-generate secrets
     NEXTAUTH_SECRET=$(openssl rand -base64 32)
     ENCRYPTION_KEY=$(openssl rand -hex 32)
     DB_PASSWORD=$(openssl rand -base64 24)
     
     sed -i.bak "s/NEXTAUTH_SECRET=.*/NEXTAUTH_SECRET=\"$NEXTAUTH_SECRET\"/" .env
     sed -i.bak "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=\"$ENCRYPTION_KEY\"/" .env
     sed -i.bak "s/DB_PASSWORD=.*/DB_PASSWORD=\"$DB_PASSWORD\"/" .env
     
     echo "✅ Secrets đã được generate tự động"
     echo "⚠ Hãy mở file .env và config thêm:"
     echo "   - Platform credentials (YouTube, Facebook, ...)"
     echo "   - Email service (Resend API key)"
     echo "   - Domain settings"
     read -p "Bấm Enter sau khi config xong..."
   fi
   
   # Pull/build images
   echo "🐳 Building Docker images..."
   docker-compose build
   
   # Start services
   echo "▶️ Starting services..."
   docker-compose up -d
   
   # Wait for DB
   echo "⏳ Waiting for database..."
   sleep 10
   
   # Run migrations
   echo "📊 Running migrations..."
   docker-compose exec api npx prisma migrate deploy
   
   # Setup first tenant
   echo ""
   echo "🏢 Setup tenant đầu tiên:"
   read -p "  Tên công ty: " COMPANY_NAME
   read -p "  Slug (vd: abc-media): " COMPANY_SLUG
   read -p "  Email admin: " ADMIN_EMAIL
   read -s -p "  Password admin: " ADMIN_PASSWORD
   echo ""
   
   docker-compose exec api node dist/scripts/setup-tenant.js \
     --name "$COMPANY_NAME" \
     --slug "$COMPANY_SLUG" \
     --admin-email "$ADMIN_EMAIL" \
     --admin-password "$ADMIN_PASSWORD"
   
   echo ""
   echo "✅ Cài đặt xong!"
   echo ""
   echo "📍 Truy cập:"
   echo "   App: http://${COMPANY_SLUG}.localhost:3000"
   echo "   API: http://localhost:3001"
   echo ""
   echo "🔐 Đăng nhập: $ADMIN_EMAIL"
   ```

3. /scripts/setup-tenant.ts — programmatic tenant creation:
   ```typescript
   import { prisma } from '@/db'
   import bcrypt from 'bcryptjs'
   
   async function setupTenant(args: { name, slug, adminEmail, adminPassword }) {
     const tenant = await prisma.tenant.create({
       data: {
         name: args.name,
         slug: args.slug,
         subscriptionTier: 'FREE'
       }
     })
     
     const admin = await prisma.employee.create({
       data: {
         tenantId: tenant.id,
         email: args.adminEmail,
         password: await bcrypt.hash(args.adminPassword, 10),
         fullName: 'Admin',
         role: 'TENANT_ADMIN',
         joinDate: new Date()
       }
     })
     
     // Tạo default departments
     await prisma.department.createMany({
       data: [
         { tenantId: tenant.id, name: 'Marketing', color: '#534AB7' },
         { tenantId: tenant.id, name: 'Tin tức', color: '#1D9E75' },
         { tenantId: tenant.id, name: 'Giải trí', color: '#D85A30' }
       ]
     })
     
     console.log(`✅ Tenant "${args.name}" created`)
     console.log(`   Login: ${args.adminEmail}`)
     console.log(`   URL: https://${args.slug}.tracker.com`)
   }
   ```

4. /apps/web/Dockerfile + /apps/api/Dockerfile multi-stage builds.

Test: clone fresh, chạy ./scripts/setup.sh → verify cài thành công.
```

### Prompt 7.2 — INSTALL_GUIDE.md cho team khác

```
Đọc CLAUDE.md V2 trước.

Tạo file INSTALL_GUIDE.md ở root với nội dung:

# HR + Channel Tracker — Hướng dẫn cài đặt

## Yêu cầu hệ thống
- Docker 24+ và Docker Compose v2
- 4GB RAM tối thiểu, 8GB khuyến nghị
- 20GB storage
- Domain riêng (vd: tracker.yourcompany.com) — KHUYẾN NGHỊ
- HOẶC dùng IP public + port mapping

## Cài đặt nhanh (15 phút)

### Bước 1: Clone source code
```bash
git clone https://github.com/yourorg/hr-channel-tracker.git
cd hr-channel-tracker
```

### Bước 2: Đăng ký các services bên thứ 3 (tùy chọn nhưng khuyến nghị)
- YouTube Data API: console.cloud.google.com
- Facebook/Instagram: developers.facebook.com
- Telegram Bot: chat @BotFather
- Email: resend.com (free 3000 emails/tháng)

### Bước 3: Chạy installer
```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

Script sẽ:
1. Generate secrets tự động
2. Yêu cầu bạn config platform tokens
3. Build Docker images
4. Tạo database + run migrations
5. Setup tenant đầu tiên

### Bước 4: Truy cập
- App: http://yourtenantslug.localhost:3000 (local)
- HOẶC https://yourtenantslug.yourdomain.com (production với DNS)

## Cài đặt production (cho công ty thật)

### DNS Setup
Cấu hình wildcard DNS trỏ về server:
```
*.tracker.yourcompany.com  →  YOUR_SERVER_IP
admin.tracker.yourcompany.com → YOUR_SERVER_IP
```

### SSL Certificates
Dùng Caddy reverse proxy (auto SSL):
```caddyfile
*.tracker.yourcompany.com {
  reverse_proxy localhost:3000
}
```

### Backup setup
- Database backup hàng ngày qua cronjob:
```bash
0 2 * * * docker-compose exec postgres pg_dump -U tracker hr_tracker > /backups/hr_$(date +\%Y\%m\%d).sql
```

## Tạo thêm tenant (cho khách hàng mới)

```bash
docker-compose exec api node dist/scripts/setup-tenant.js \
  --name "Tên công ty mới" \
  --slug "ten-cong-ty" \
  --admin-email "admin@email.com" \
  --admin-password "..." \
  --tier "STARTER"
```

## Troubleshooting

### App không vào được
1. Check services: `docker-compose ps`
2. Check logs: `docker-compose logs -f web` hoặc `api`
3. Restart: `docker-compose restart`

### Database connection error
- Verify .env DATABASE_URL
- Check Postgres container: `docker-compose exec postgres psql -U tracker`

### Sync metrics không chạy
- Check worker container: `docker-compose logs -f worker`
- Verify platform tokens trong .env
- Check quota: redis-cli → KEYS quota:*

## Maintenance

### Update lên version mới
```bash
git pull
docker-compose build
docker-compose up -d
docker-compose exec api npx prisma migrate deploy
```

### Backup & Restore
[Hướng dẫn chi tiết...]

## Hỗ trợ
- Email: support@yourdomain.com
- Docs: https://docs.yourdomain.com

Cập nhật CLAUDE.md: ghi "Day 7: Installer + Documentation hoàn thành. V2 ready for deployment."
```

### Prompt 7.3 — Final review + commit

```
Đọc CLAUDE.md V2 trước.

Final review V2 refactor:

1. Chạy full test suite:
   npm run test
   npm run test:e2e
   npm run typecheck
   npm run build

2. Manual smoke test:
   - Tạo 2 tenants khác nhau
   - Đăng nhập từng tenant, verify isolation
   - Tạo employees, departments, channels cho mỗi tenant
   - Sync metrics manually
   - Tạo KPIs (channel-level + employee-level)
   - Verify achievement calculation đúng
   - Test mobile responsive
   - Test super admin panel (admin.localhost)

3. Audit code:
   - Tìm các tham chiếu còn sót đến Post, Calendar, Workflow:
     grep -r "post" apps/ packages/ --include="*.ts" | grep -v node_modules
   - Verify mọi Prisma query đều respect tenantId
   - Check không còn console.log debug code

4. Update documentation:
   - README.md ở root: tổng quan dự án V2
   - CHANGELOG.md: ghi V1 → V2 migration
   - CLAUDE.md: CURRENT PHASE = "V2 hoàn thành, ready for production"

5. Tạo PR (Pull Request):
   git add .
   git commit -m "refactor: complete V2 — HR + Channel Tracker with multi-tenant"
   git push origin refactor/v2-hr-tracker
   
   Trên GitHub: tạo PR từ refactor/v2-hr-tracker → main
   PR description: link đến MIGRATION_PLAN.md, list các thay đổi chính

6. Sau merge: tag release v2.0.0
   git checkout main
   git pull
   git tag -a v2.0.0 -m "V2 release: HR + Channel Tracker"
   git push origin v2.0.0

🎉 V2 refactor complete!
```

---

## Checklist tổng — đảm bảo không sót gì

### Cleanup verification (sau Day 1)
- [ ] Không còn folder calendar/, posts/, media/, review/
- [ ] Không còn references đến Post, MediaLibrary, WorkflowHistory model
- [ ] Build thành công, không có TypeScript errors
- [ ] Sidebar chỉ có menu items mới

### Architecture verification (sau Day 6)
- [ ] Mọi Prisma model có tenantId (trừ Tenant)
- [ ] Login từ subdomain A không thấy data của tenant B
- [ ] Super admin (admin.localhost) thấy tất cả tenants
- [ ] Subscription limits enforce đúng

### Functional verification (sau Day 7)
- [ ] Tạo tenant mới qua installer trong < 5 phút
- [ ] Sync metrics tự động chạy mỗi giờ
- [ ] KPI achievement tính đúng cho cả 2 scope
- [ ] Per-employee dashboard hiển thị channels + KPIs
- [ ] Mobile responsive trên iPhone + Android
- [ ] PWA install được

---

## Lời khuyên cuối

1. **Mỗi ngày commit ít nhất 1 lần** — không gộp 7 ngày vào 1 commit khổng lồ
2. **Test sau mỗi prompt** — đừng chạy cả Day 1 rồi mới test
3. **Nếu Claude Code nhầm hoặc làm sai** → bạn có quyền bảo "Hãy dừng và đọc lại CLAUDE.md V2 trước"
4. **Backup database trước khi migrate** — đặc biệt Day 6 multi-tenant migration là risky
5. **Tạo branch riêng cho mỗi day** nếu thấy refactor lớn:
   ```bash
   git checkout -b refactor/v2-day-2-channels
   ```
