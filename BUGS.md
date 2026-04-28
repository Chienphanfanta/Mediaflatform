# Bug Tracker

> File này dành cho bạn (user) ghi lại bugs khi test app. Mỗi bug 1 entry, sắp xếp theo **severity giảm dần**.
>
> Khi muốn fix một loạt bugs:
> 1. Mở file này, paste vào chat: "Fix bugs trong BUGS.md theo priority"
> 2. Tôi sẽ làm từng bug — root cause → fix → unit test → update KNOWN ISSUES (CLAUDE.md) → CONFIRM bạn test OK → sang bug tiếp theo
> 3. Khi bug fix xong: di chuyển entry xuống section **"Đã fix"** ở cuối file (giữ history) hoặc xoá nếu trivial.

---

## Cách phân loại severity

| Mức | Định nghĩa | SLA fix |
|---|---|---|
| 🔴 **Critical** | Chặn user hoàn toàn (không login, không tạo bài, server crash) | Fix ngay |
| 🟠 **High** | UX bị broken nhưng còn workaround (button không click được, page render sai) | < 1 ngày |
| 🟡 **Medium** | Sai data/logic nhỏ (hiển thị sai số, format wrong, missing field) | < 1 tuần |
| 🟢 **Low** | Cosmetic (typo, alignment lệch, color sai shade) | Khi rảnh |

---

## Template (copy + fill khi log bug mới)

```markdown
### Bug #N — [🔴/🟠/🟡/🟢] Tên ngắn gọn
- **Module/URL:** /hr/[id] hoặc /api/v1/users
- **Steps to reproduce:**
  1. Login admin@company.com / Admin123!
  2. Click sidebar "Nhân sự"
  3. ...
- **Expected:** Hiện list 6 users + KPI
- **Actual:** Trang trắng, console có error "..."
- **Screenshot/log:** (paste hoặc gắn link)
- **Browser:** Firefox 142 incognito / Chrome 130 / Edge ...
- **Tần suất:** 100% / Đôi khi / 1 lần thấy
```

---

## 🟢 Bugs đang mở

> Smoke test session 2026-04-26 (Round 1) — 14 routes + 11 API endpoints. Tất cả 7 bugs Round 1 đã fix.
> Test session 2026-04-26 (Round 2 — chiều) — verify regression sau fix + test write APIs (create post, workflow transitions, alert mark-read) + test 3 roles (admin/manager/staff) + edge cases (pagination, invalid dates, cross-group permission). RBAC working đúng. Phát hiện thêm 2 bugs.

### Bug #8 — [🟡 Medium] DRAFT post không hiển thị trong /calendar grid

- **Module/URL:** `/calendar` + `/api/v1/calendar`
- **Steps to reproduce:**
  1. Login admin (admin@company.com / Admin123!)
  2. Vào `/calendar` → click "Thêm bài"
  3. Fill form (chọn channel + title) — KHÔNG set `scheduledAt`, status mặc định DRAFT
  4. Submit → dialog đóng → calendar grid render lại
  5. Bài mới biến mất khỏi UI
- **Expected:** DRAFT post hiển thị trong calendar (vd ở vị trí `createdAt`) với style mờ/dashed border như status DRAFT đã quy định trong [event-pill.tsx](apps/web/src/components/calendar/event-pill.tsx) (`opacity-60`)
- **Actual:** API `/api/v1/calendar?start=...&end=...` chỉ filter `scheduledAt OR publishedAt trong range` — DRAFT không có cả 2 → invisible
- **Root cause:** [apps/web/src/app/api/v1/calendar/route.ts:42-48](apps/web/src/app/api/v1/calendar/route.ts) where clause:

```ts
OR: [
  { scheduledAt: { gte: start, lte: end } },
  { publishedAt: { gte: start, lte: end } },
],
```

  Bỏ qua status DRAFT/REVIEWING/APPROVED/REJECTED không có scheduledAt.
- **Impact:** User tạo DRAFT → tưởng bị mất → tạo lại → duplicate. Cũng là blocker cho workflow Staff "submit bài cho Manager duyệt" — bài REVIEWING không có scheduledAt cũng invisible.
- **Tần suất:** 100% với DRAFT/REVIEWING/APPROVED/REJECTED không scheduledAt
- **Verified via curl:** Tạo DRAFT post → query calendar 60 ngày → "Found in calendar: NO. Total events: 1 (SCHEDULED)"
- **Đề xuất fix:** Mở rộng OR clause thêm `{ AND: [{ scheduledAt: null }, { publishedAt: null }, { createdAt: { gte: start, lte: end } }] }` — DRAFT/REVIEWING dùng `createdAt` làm timeline anchor.

### Bug #9 — [🟢 Low] Calendar query không validate `end >= start`

- **Module/URL:** `/api/v1/calendar`
- **Steps to reproduce:**
  ```bash
  curl "/api/v1/calendar?start=2026-12-01T00:00:00Z&end=2026-01-01T00:00:00Z"
  ```
- **Expected:** 422 Validation Failed như analytics export (đã có `.refine((d) => d.to >= d.from)`)
- **Actual:** 200 với empty events array
- **Root cause:** [apps/web/src/lib/schemas/calendar.ts (hoặc inline trong route.ts)](apps/web/src/app/api/v1/calendar/route.ts) thiếu refine. Inconsistent với [analytics.ts:41-58](apps/web/src/lib/schemas/analytics.ts) đã có refine.
- **Impact:** Chỉ confuse khi user gõ params nhầm. Không phải security/data issue.
- **Tần suất:** 100% nếu end < start

---

## ✅ Verifications passed (Round 2 — không bug)

- [x] **RBAC matrix** — admin (full), manager (no /settings), staff (no /hr, /reports, /review) → middleware redirect 307 đúng
- [x] **API permissions** — staff vào `/api/v1/users` 403, `/api/v1/review-queue` 403, `/api/v1/calendar` 200 ✅
- [x] **Cross-group scope** — Manager (Content) xem user thuộc Analytics group → 403 ✅
- [x] **Workflow state machine** — DRAFT→REVIEWING→APPROVED happy path; REJECT từ APPROVED → 422 WORKFLOW_INVALID_STATE đúng
- [x] **Soft delete** — `DELETE /api/v1/posts/:id` → 204
- [x] **Pagination clamp** — `page=-1`, `pageSize=10000` → 200 (clamped)
- [x] **Invalid date** — `start=invalid` → 422
- [x] **Schema validation** — PATCH `/api/v1/notifications/settings` với `pushEnabled:"yes"` → 422 với chi tiết `Expected boolean, received string`
- [x] **Bull Board (Bug #1 fix)** — basic auth at `:4000/admin/queues` → 200 với credentials đúng
- [x] **Analytics export (Bug #2 fix)** — `?format=csv&preset=30d` → 200 + 10KB CSV cho 3 channels
- [x] **/hr/[invalid-id] (Bug #6 fix)** — `/api/v1/users/invalid` → 404 với code USER_NOT_FOUND. UI render NotFoundState card.
- [x] **Console clean** — web dev log không có error/exception trong test session

---

## ✅ Bugs đã fix (trong session vừa rồi)

Lưu lại để tham chiếu — đừng xoá kẻo mất context khi review tech debt.

### Bug — [🟠 High] Nút "Bull Board" trong /settings/queues link sai → 404

- **Module:** `/settings/queues` button "Bull Board"
- **Root cause:** `<a href="/admin/queues">` relative → trỏ web `:3001/admin/queues` (404). Bull Board mount ở apps/api `:4000`.
- **Fix:** Đổi href sang `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/admin/queues`. Production override `NEXT_PUBLIC_API_URL` env.
- **File:** [apps/web/src/app/(dashboard)/settings/queues/page.tsx:159-167](apps/web/src/app/(dashboard)/settings/queues/page.tsx)
- **Date:** 2026-04-26
- **Test:** Click button → mở tab `:4000/admin/queues` → basic auth prompt (admin / devpass) → Bull Board UI

### Bug — [🟠 High] Nút Export "CSV" trong /analytics trả 422 (thiếu channelIds)

- **Module:** `/analytics` ExportButton (mobile + desktop dropdown)
- **Root cause:** Schema `exportQuerySchema` yêu cầu `channelIds[].min(1)` + `from` + `to` bắt buộc. ExportButton chỉ pass `preset` + `format`. Server reject 422.
- **Fix:** Schema giờ optional cho `channelIds` (nếu rỗng → server tự include all channels user có quyền) + `from`/`to` (nếu rỗng → derive từ `preset` shortcut, default 30d). Backwards compatible với caller cũ (channel-header.tsx vẫn pass channelIds explicit).
- **Files:**
  - [apps/web/src/lib/schemas/analytics.ts:41-58](apps/web/src/lib/schemas/analytics.ts)
  - [apps/web/src/app/api/v1/analytics/export/route.ts:37-86](apps/web/src/app/api/v1/analytics/export/route.ts)
- **Date:** 2026-04-26
- **Test:** `curl /api/v1/analytics/export?format=csv&preset=30d` → 200 + 10KB CSV với 90 rows × 12 cols cho 3 channels

### Bug — [🟡 Medium] Sidebar thiếu link `/review` và `/alerts`

- **Module:** Sidebar nav
- **Root cause:** [nav-items.tsx](apps/web/src/components/dashboard/nav-items.tsx) `NAV_ITEMS` thiếu 2 entries; auth.config.ts cũng thiếu route patterns.
- **Fix:** Thêm 2 entries vào nav-items.tsx (Stamp icon cho Duyệt bài MANAGER+, Bell icon cho Cảnh báo VIEWER+) + 2 patterns vào ROUTE_RBAC.
- **Files:**
  - [apps/web/src/components/dashboard/nav-items.tsx:34-35](apps/web/src/components/dashboard/nav-items.tsx)
  - [apps/web/src/auth.config.ts:18,20](apps/web/src/auth.config.ts)
- **Date:** 2026-04-26
- **Test:** Login Manager → sidebar có 9 entries (cũ 7 + Duyệt bài + Cảnh báo); login Staff → không thấy "Duyệt bài" nhưng vẫn thấy "Cảnh báo"

### Bug — [🟡 Medium] /calendar/failed không có cách click vào từ UI

- **Module:** `/calendar` toolbar
- **Root cause:** [calendar-toolbar.tsx](apps/web/src/components/calendar/calendar-toolbar.tsx) chỉ có nút "Thêm bài" — không có link tới `/calendar/failed`.
- **Fix:** Thêm Button outline asChild với `<Link href="/calendar/failed">` + AlertTriangle icon, đặt cạnh "Thêm bài".
- **File:** [apps/web/src/components/calendar/calendar-toolbar.tsx:15,86-91](apps/web/src/components/calendar/calendar-toolbar.tsx)
- **Date:** 2026-04-26
- **Test:** Vào `/calendar` → toolbar có button "Bài thất bại" cạnh "Thêm bài" → click → `/calendar/failed`

### Bug — [🟡 Medium] Page title không cá nhân hoá theo route

- **Module:** Mọi page (`<title>` HTML — tab browser)
- **Root cause:** Chỉ root layout set `metadata.title = "Media Ops Platform"`. Các page không export metadata/generateMetadata. Phần lớn page là client component nên không thể export `metadata` thuần từ Next.js (chỉ server component được).
- **Fix:** Tạo `<DocumentTitleSync />` client component trong [page-title.tsx](apps/web/src/components/dashboard/page-title.tsx) — dùng `useEffect` set `document.title = "{label} — Media Ops Platform"` theo `usePathname()`. Mount trong [layout.tsx](apps/web/src/app/(dashboard)/layout.tsx). Initial SSR HTML vẫn có "Media Ops Platform" (no flash); sau hydration update theo route.
- **Files:**
  - [apps/web/src/components/dashboard/page-title.tsx](apps/web/src/components/dashboard/page-title.tsx) — thêm `useDocumentTitle()` hook + `<DocumentTitleSync />` component
  - [apps/web/src/app/(dashboard)/layout.tsx](apps/web/src/app/(dashboard)/layout.tsx) — mount `<DocumentTitleSync />`
- **Date:** 2026-04-26
- **Test:** Mở `/hr` → tab title "Nhân sự — Media Ops Platform"; `/calendar` → "Content Calendar — Media Ops Platform"; `/profile` → "Trang cá nhân — Media Ops Platform"

### Bug — [🟢 Low] /hr/[invalid-id] render 200 + error inline thay vì 404 cleaner

- **Module:** `/hr/[id]`
- **Root cause:** Page là client component dùng useQuery — bất kỳ error (404 invalid ID hay 500 transient) đều cùng render qua Alert đỏ chung. UX không phân biệt "không tìm thấy" vs "lỗi network".
- **Fix:**
  1. Custom `HRFetchError` class lưu HTTP status + error code khi queryFn parse response
  2. React Query `retry: (failureCount, err) => err.status === 404 ? false : failureCount < 2` — không retry 404 (invalid ID không tự lành)
  3. UI branch: `isNotFound` → render `<NotFoundState />` empty card với UserX icon + nút "Về danh sách nhân sự". `isError` (non-404) → giữ Alert retry như cũ.
- **File:** [apps/web/src/app/(dashboard)/hr/[id]/page.tsx](apps/web/src/app/(dashboard)/hr/[id]/page.tsx)
- **Date:** 2026-04-26
- **Test:** Vào `/hr/abc-fake-id-123` → empty state Card với UserX + nút "Về danh sách nhân sự" thay vì Alert đỏ; vào real ID → load detail bình thường; tạm tắt API → Alert "Không tải được" với nút "Thử lại".

### Bug — [🟢 Low] /reports thiếu retry button trong error Alert

- **Module:** `/reports`
- **Root cause:** Error Alert đã có (line 333-339) nhưng không có nút "Thử lại" inline. User phải tự click 1 trong 3 button (Preview/PDF/CSV) để retry — UX không nhất quán với /dashboard, /analytics đã có retry button.
- **Fix:** Track `lastFormat` state set trong `fetchReport(format)`. Error Alert thêm Button "Thử lại {format}" — call `fetchReport(lastFormat)`. Disabled khi `loading !== null`.
- **File:** [apps/web/src/app/(dashboard)/reports/page.tsx:82-128,333-352](apps/web/src/app/(dashboard)/reports/page.tsx)
- **Date:** 2026-04-26
- **Test:** Vào `/reports` → click "Download PDF" với type=null → API trả 422 → Alert hiện "Tạo báo cáo thất bại" + nút "Thử lại PDF" → click → re-attempt PDF

### Bug — [🔴 Critical] NextAuth `MissingSecret` → login không hoạt động
- **Module:** `/login` (NextAuth credentials provider)
- **Root cause:** `.env` ở monorepo root nhưng Next.js chỉ đọc env trong `apps/web/`. Variable `AUTH_SECRET` không truyền tới middleware.
- **Fix:** copy `.env` thành `apps/web/.env.local` + `apps/api/.env`.
- **Date:** 2026-04-26
- **Commit:** (chưa commit — local only)

### Bug — [🔴 Critical] Login form submit GET với password lộ trên URL
- **Module:** `/login` (LoginForm component)
- **Root cause:** Console Ninja VS Code extension inject syntax-broken JS vào webpack bundle ("string literal not terminated") → React không hydrate → form fall back native HTML GET submit.
- **Fix:** Rename folder `~/.vscode/extensions/wallabyjs.console-ninja-1.0.525/` thành `.DISABLED` để VS Code không load được. Restart Next dev clean `.next`.
- **Date:** 2026-04-26
- **Followup:** User cần rename ngược lại nếu muốn dùng Console Ninja cho project khác.

### Bug — [🟠 High] `/hr` 404 (Module Nhân sự)
- **Module:** `/hr`
- **Root cause:** Sidebar link tồn tại + middleware allow MANAGER+ nhưng folder `apps/web/src/app/(dashboard)/hr/` không có. Phase 8 TODO chưa làm.
- **Fix:** Build `lib/hr-metrics.ts` + 2 endpoints (`/api/v1/users`, `/api/v1/users/[id]`) + 2 pages (list + detail) + delete `/staff` stub.
- **Date:** 2026-04-26

### Bug — [🟠 High] `/hr/[id]` runtime error "An unsupported type was passed to use()"
- **Module:** `/hr/[id]`
- **Root cause:** Tôi viết `params: Promise<{id: string}>` + `use(params)` (Next.js 15 async params). Project chạy Next 14.2.35 — params là plain object.
- **Fix:** Đổi signature `params: { id: string }` + lấy `const { id } = params` trực tiếp.
- **Date:** 2026-04-26

### Bug — [🟠 High] `/settings` 404 (Module Cài đặt)
- **Module:** `/settings`
- **Root cause:** Chỉ có sub-pages `/settings/notifications` và `/settings/queues`, không có `page.tsx` index.
- **Fix:** Build `/settings/page.tsx` index liệt kê 5 categories cards (active + Phase 9 stubs disabled).
- **Date:** 2026-04-26

### Bug — [🟠 High] `/profile` 404 (Trang cá nhân)
- **Module:** `/profile` (link từ user-menu dropdown)
- **Root cause:** Folder `apps/web/src/app/(dashboard)/profile/` không có. Sidebar avatar dropdown vẫn link tới.
- **Fix:** Build `/profile/page.tsx` (server component) — show user info + groups + role + 3 quick action cards + logout form.
- **Date:** 2026-04-26

### Bug — [🟡 Medium] Calendar filter "Người phụ trách" thiếu báo cáo tổng hợp
- **Module:** `/calendar` filter sidebar
- **Root cause:** Khi tick 1 author, calendar grid filter nhưng vẫn hiển thị posts từng kênh từng ngày — user không thấy KPI tổng.
- **Fix:** Build `<AuthorSummaryCard>` render khi `authorIds.length === 1` — 4 stat tiles + platform breakdown + link `/hr/[id]`. Mount cả desktop và mobile.
- **Date:** 2026-04-26

---

## 🚧 Known Limitations (không phải bug — limitation environment)

Các vấn đề user đã gặp nhưng KHÔNG fix vì là limitation của môi trường dev:

- **Redis 3.0.504 không tương thích BullMQ ≥5.0** → API logs spam `Error: Redis version needs to be greater or equal than 5.0.0`. Workaround: cài Memurai (`winget install Memurai.MemuraiDeveloper`) hoặc Upstash cloud. Web UI vẫn chạy bình thường — chỉ `/admin/queues` (Bull Board) + `/settings/queues` (Queue Monitor) ảnh hưởng.
- **Console Ninja VS Code extension** inject broken JS → đã rename folder để vô hiệu hoá. Nếu user reinstall VS Code hoặc update extension, có thể tái xuất hiện.
- **Neon Postgres free tier** sleep sau 5 phút idle → cold start ~2-5s → request đầu tiên có thể timeout. React Query đã có `retry: 2` mitigate.

---

## Convention khi điền

- Đừng paste log dài hàng nghìn dòng vào file này — link tới gist/file tách riêng.
- Nếu bug có nhiều biểu hiện liên quan, gộp 1 entry với "Symptoms" liệt kê.
- Khi fix, luôn ghi date + commit hash (nếu có) để dễ review.
