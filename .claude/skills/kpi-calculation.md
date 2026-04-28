# KPI Calculation — formulas, status logic, edge cases

> Schema: [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma) (`KPI` model).
> Calculator (web): [apps/web/src/lib/kpi/calculator.ts](../../apps/web/src/lib/kpi/calculator.ts).
> Calculator (api/cron): [apps/api/src/modules/kpi/kpi-calculator.service.ts](../../apps/api/src/modules/kpi/kpi-calculator.service.ts).

---

## 1. KPI Scope

KPI luôn gắn với 1 `employeeId`. `scope` quyết định channels nào tính vào actual:

| Scope | `channelId` | Actual = aggregate của |
|-------|-------------|------------------------|
| `PER_CHANNEL` | required | đúng 1 kênh đó |
| `PER_EMPLOYEE` | null | tất cả kênh employee là PRIMARY/SECONDARY owner (qua `ChannelOwnership`) |

**Use case:**
- `PER_CHANNEL`: chỉ tiêu cụ thể cho YouTube channel của contentManager (vd: 1.5M views/tháng).
- `PER_EMPLOYEE`: chỉ tiêu tổng cho contentManager — sum metrics across YouTube + Instagram cùng owner.

**Rule:** Validate ở `createKpiSchema`:
```ts
.refine((d) => (d.scope === 'PER_CHANNEL' ? !!d.channelId : true),
  { message: 'PER_CHANNEL phải kèm channelId' })
```

---

## 2. Achievement formula

5 targets (tất cả nullable, "higher is better"):

| Target | Actual aggregation |
|--------|--------------------|
| `targetFollowers` | `subscribers` của Analytics record latest trong period (PER_EMPLOYEE: SUM của latest mỗi channel) |
| `targetFollowersGain` | `SUM(subscriberDelta)` trong period |
| `targetViews` | `SUM(views)` trong period |
| `targetWatchTime` | `SUM(watchTimeHours)` trong period |
| `targetEngagement` | `AVG(engagementRate)` trong period |

### Per-target percent

```ts
function pct(actual: number | null, target: number | null | undefined): number | null {
  if (target == null || target === 0) return null;   // skip targets không set
  if (actual == null) return 0;                      // có target nhưng chưa có data
  return Math.round((actual / target) * 10000) / 100; // 2 decimal places
}
```

### Average (chiến lược V2)

```ts
const setPercents = Object.values(perTargetPercent).filter((v): v is number => v !== null);

const averagePercent = setPercents.length > 0
  ? Math.round((setPercents.reduce((s, v) => s + v, 0) / setPercents.length) * 100) / 100
  : null;
```

**Tradeoff đã chọn:** arithmetic mean của các target có set. Đơn giản, dễ explain. Targets không set bị skip — KPI 1-target và KPI 5-targets không bị unfair.

### Alternative: weighted (chưa implement)

Nếu cần weight (vd followers quan trọng hơn engagement):
```ts
const WEIGHTS = { followers: 0.3, followersGain: 0.2, views: 0.25, watchTime: 0.15, engagement: 0.1 };

const weighted = Object.entries(perTargetPercent)
  .filter(([, v]) => v !== null)
  .reduce((acc, [k, v]) => {
    const w = WEIGHTS[k] ?? 0;
    return { sum: acc.sum + v * w, weight: acc.weight + w };
  }, { sum: 0, weight: 0 });

const weightedPercent = weighted.weight > 0 ? weighted.sum / weighted.weight : null;
```

→ Defer cho đến khi có business request rõ ràng. Nếu adopt: store WEIGHTS riêng theo tenant `Tenant.settings.kpiWeights`.

### PER_EMPLOYEE actuals query

```ts
// 1. Tìm channels employee phụ trách (PRIMARY hoặc SECONDARY)
const channels = await prisma.channel.findMany({
  where: {
    deletedAt: null,
    ownerships: { some: { employeeId } },
  },
  select: { id: true },
});

// 2. Aggregate analytics across all channelIds
const agg = await prisma.analytics.aggregate({
  where: {
    channelId: { in: channels.map((c) => c.id) },
    date: { gte: periodStart, lte: periodEnd },
  },
  _sum: { views: true, watchTimeHours: true, subscriberDelta: true },
  _avg: { engagementRate: true },
});

// 3. Followers = SUM(latest subscribers per channel) — Postgres-specific:
const latestPerChannel = await prisma.$queryRaw<Array<{ subscribers: number }>>`
  SELECT DISTINCT ON ("channelId") "subscribers"
  FROM "Analytics"
  WHERE "channelId" = ANY(${channelIds}::text[]) AND "date" <= ${periodEnd}::date
  ORDER BY "channelId", "date" DESC
`;
```

---

## 3. Status determination

```ts
function deriveStatus(achievementPercent, periodStart, periodEnd, now): KPIStatus {
  if (now < periodStart) return 'NOT_STARTED';

  const periodEnded = now > periodEnd;

  if (achievementPercent === null) {
    // Không target nào set → status thuần theo dates
    return periodEnded ? 'MISSED' : 'IN_PROGRESS';
  }

  if (achievementPercent >= 120) return 'EXCEEDED';
  if (achievementPercent >= 100) return 'ACHIEVED';
  return periodEnded ? 'MISSED' : 'IN_PROGRESS';
}
```

| Status | Điều kiện |
|--------|-----------|
| `NOT_STARTED` | `now < periodStart` |
| `IN_PROGRESS` | trong period, `achievement < 100%` |
| `ACHIEVED` | `100% ≤ achievement < 120%` (kể cả mid-period — đạt sớm) |
| `EXCEEDED` | `achievement ≥ 120%` |
| `MISSED` | `now > periodEnd && achievement < 100%` |

**Note:** `ACHIEVED` hoặc `EXCEEDED` có thể xảy ra mid-period (đạt sớm). Status không chuyển ngược về `IN_PROGRESS` ngay cả khi mid-period — UI hiển thị "đã đạt sớm".

---

## 4. Period calculation helpers

Dùng `date-fns`:

```ts
import { endOfMonth, endOfQuarter, endOfYear } from 'date-fns';

export function derivePeriodEnd(periodType: PeriodType, periodStart: Date): Date {
  switch (periodType) {
    case 'MONTHLY':   return endOfMonth(periodStart);
    case 'QUARTERLY': return endOfQuarter(periodStart);
    case 'YEARLY':    return endOfYear(periodStart);
  }
}

// Helper "current period" cho UI
export function currentPeriodFor(periodType: PeriodType, now = new Date()): { start: Date; end: Date } {
  if (periodType === 'MONTHLY') {
    const start = startOfMonth(now);
    return { start, end: endOfMonth(start) };
  }
  if (periodType === 'QUARTERLY') {
    const start = startOfQuarter(now);
    return { start, end: endOfQuarter(start) };
  }
  const start = startOfYear(now);
  return { start, end: endOfYear(start) };
}
```

**KHÔNG hardcode** số ngày trong tháng (`new Date(year, month, 31)` sai cho Feb). Luôn dùng `endOfMonth/Quarter/Year`.

---

## 5. Edge cases

### 5.1. Nhân viên join giữa period

**Hiện tại:** không prorate. KPI tính như employee có mặt full period — sẽ dẫn đến `MISSED` không công bằng.

**Workaround tạm:** Manager tạo KPI với `periodStart = ngày employee join` thay vì đầu tháng. KPI custom-period không match auto current-month nhưng vẫn valid.

**Future fix (Sprint 7+):** thêm field `prorateFromDate` trên KPI. Calculator sẽ scale targets theo `(daysInPeriod - daysBeforeJoin) / daysInPeriod`. Hoặc store `User.joinDate` và tự prorate.

### 5.2. Channel transfer ownership giữa period

**Hiện tại:** `ChannelOwnership` chỉ giữ snapshot CURRENT (không có audit history). Khi recalc:
- Channel actuals (PER_CHANNEL): không bị ảnh hưởng — actuals của channel là nguyên một.
- Employee actuals (PER_EMPLOYEE): chỉ thấy channels employee đang là owner LÚC RECALC, không phải lúc period bắt đầu.

→ Nếu transfer giữa period, employee mới sẽ "ăn ké" actuals của channel cho cả period (kể cả thời gian chưa phụ trách).

**Workaround:** thêm `assignedAt` filter vào employee actuals query — chỉ count Analytics rows với `date >= ChannelOwnership.assignedAt`. Em chưa implement vì:
1. ChannelOwnership.assignedAt là thời điểm gán role, không phải period boundary
2. Cần audit log đầy đủ (Sprint 7+)

**Recommendation:** transfer ownership chỉ làm ở period boundary (đầu tháng). Manager tạo KPI mới cho employee mới khi cần.

### 5.3. Target edit sau khi KPI chạy

**Hiện tại:** PUT `/api/v1/kpi/:id` cho phép update targets. Cron daily 7am sẽ recalc next tick. Manual `POST /:id/recalculate` recalc immediately.

**Behavior:** `achievementPercent` flip (vd nâng targetViews → percent giảm). Status có thể flip (ACHIEVED → IN_PROGRESS).

**Audit:** chưa có log "ai sửa target khi nào". V2 chỉ giữ `assignedById/At` (lúc tạo). Sprint 7+ thêm `KPIChangeLog` table nếu cần.

### 5.4. Channel ARCHIVED giữa period

`Channel.status = ARCHIVED` không lọc khỏi actuals query (vì `deletedAt: null` vẫn match). Cron vẫn thấy channel đó và sum analytics đến ngày archive.

→ KPI vẫn tiếp tục tính bình thường. Đúng intent: "tháng này được bao nhiêu views" không phụ thuộc trạng thái cuối tháng.

### 5.5. Channel deleted (hard delete)

KPI có `channelId` FK với `onDelete: SetNull`. Khi channel bị hard delete (hiếm — V2 chỉ soft delete), `KPI.channelId` thành null nhưng `KPI.scope` vẫn là `PER_CHANNEL`.

→ `recalculateAchievement()` sẽ throw `'KPI scope=PER_CHANNEL nhưng channelId null'`. Cron skip + log error. Manual recalc 500.

**Fix:** sửa hard delete thành block khi có KPI active. Hoặc auto-set `KPI.status = MISSED` cùng với set null. Defer.

---

## 6. Performance optimization

### 6.1. Cache achievement trong KPI table

`KPI.achievementPercent` + `KPI.status` được persist sau mỗi recalc. UI list không cần recalc — đọc cached value đã đủ.

```ts
// ✅ Read cached
const kpis = await prisma.kPI.findMany({
  where: { tenantId, employeeId },
  select: { id: true, achievementPercent: true, status: true /* ... */ },
});

// ❌ Sai — recalc on every read
for (const kpi of kpis) {
  await recalculateAchievement(kpi.id);  // N+1 queries cho aggregate Analytics
}
```

Cron daily là source-of-truth. UI có button "Recalc" cho manual trigger khi cần fresh data.

### 6.2. Indexes — cho query patterns chính

```prisma
model KPI {
  @@index([tenantId])                                // base scope
  @@index([tenantId, employeeId, periodStart])      // /summary/employee
  @@index([tenantId, channelId, periodStart])       // /summary/channel
  @@index([tenantId, status])                        // filter by status
  @@index([periodEnd])                               // cron tìm KPI vừa expire
}
```

### 6.3. Cron batch — không 1-by-1

Cron loop tenants → loop KPIs từng cái. Mỗi recalc là 2 queries (aggregate + latest). Với 5 KPIs/tenant × 100 tenants = 1000 queries. Chấp nhận được vì:
- Daily once
- Mỗi query <50ms (Analytics index `[channelId, date desc]`)

Nếu cần scale 10K+ KPIs:
- Batch theo tenant: 1 aggregate query với `groupBy: ['channelId']` cho tất cả channels của tenant
- Map results to KPIs in-memory

Defer optimization until profiling data nói cần.

### 6.4. KPI list query — chỉ filter cần thiết

```ts
// ✅ Specific filters
prisma.kPI.findMany({
  where: { employeeId, status: 'IN_PROGRESS' },  // hit index
  select: { /* chỉ field UI cần */ },
});

// ❌ Lazy includes
prisma.kPI.findMany({
  include: { channel: true, employee: true, assignedBy: true },  // 3 joins per row
});
```

Detail endpoint OK include relations. List endpoint dùng select cho minimal payload.

---

## 7. Quick reference — recalc flow

```
POST /api/v1/kpi/:id/recalculate (manual)
  OR
@Cron daily 7am Asia/Ho_Chi_Minh (apps/api KpiCronService)
        ↓
recalculateAchievement(kpiId, now)
        ↓
load KPI → dispatch by scope
        ├── PER_CHANNEL: computeChannelActuals(channelId, periodStart, periodEnd)
        └── PER_EMPLOYEE: computeEmployeeActuals(employeeId, periodStart, periodEnd)
        ↓
computeAchievement(kpi, actuals, now)
        ↓
{ averagePercent, perTargetPercent, newStatus }
        ↓
prisma.kPI.update({ achievementPercent, status })
```

Cron skips MISSED (đã lock cuối period). Mỗi KPI try/catch — 1 fail không block batch.
