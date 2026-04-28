# Skill: KPI Calculation — HR + Channel Tracker

> Đọc trước khi implement KPI features.

---

## KPI Scope

```typescript
type KPIScope = 'PER_CHANNEL' | 'PER_EMPLOYEE'
```

**PER_CHANNEL:** Target gắn với 1 kênh cụ thể.
- "Kênh YouTube ABC đạt 100K views/tháng"
- channelId là bắt buộc

**PER_EMPLOYEE:** Target tổng của nhân viên.
- "Nhân viên Alex đạt tổng 500K views/tháng từ tất cả kênh phụ trách"
- channelId = null
- Actual = SUM của tất cả channels mà employee là PRIMARY hoặc SECONDARY owner

---

## Achievement Calculation

```typescript
async function calculateAchievement(kpi: KPI): Promise<{ 
  actualMetrics: Record<string, number>,
  achievementPercent: number,
  status: KPIStatus 
}> {
  // 1. Get period range
  const { periodStart, periodEnd } = kpi
  
  // 2. Get actual metrics dựa vào scope
  let metrics
  if (kpi.scope === 'PER_CHANNEL') {
    metrics = await getChannelMetricsInPeriod(kpi.channelId, periodStart, periodEnd)
  } else {
    metrics = await getEmployeeAggregatedMetrics(kpi.employeeId, periodStart, periodEnd)
  }
  
  // 3. Calculate achievement per metric
  const achievements: number[] = []
  
  if (kpi.targetFollowersGain) {
    const actual = metrics.followersGain
    achievements.push((actual / kpi.targetFollowersGain) * 100)
  }
  if (kpi.targetViews) {
    const actual = metrics.viewsPeriod
    achievements.push((actual / kpi.targetViews) * 100)
  }
  if (kpi.targetWatchTime) {
    const actual = metrics.watchTimeHours
    achievements.push((actual / kpi.targetWatchTime) * 100)
  }
  if (kpi.targetEngagement) {
    const actual = metrics.avgEngagementRate
    achievements.push((actual / kpi.targetEngagement) * 100)
  }
  
  // 4. Average all achievements (đơn giản — có thể weighted later)
  const avgAchievement = achievements.length > 0
    ? achievements.reduce((a, b) => a + b, 0) / achievements.length
    : 0
  
  // 5. Determine status
  const now = new Date()
  let status: KPIStatus
  if (now < periodStart) {
    status = 'NOT_STARTED'
  } else if (now <= periodEnd) {
    status = avgAchievement >= 100 ? 'ACHIEVED' : 'IN_PROGRESS'
  } else {
    // Period đã end
    if (avgAchievement >= 120) status = 'EXCEEDED'
    else if (avgAchievement >= 100) status = 'ACHIEVED'
    else status = 'MISSED'
  }
  
  return {
    actualMetrics: metrics,
    achievementPercent: Math.round(avgAchievement * 10) / 10,
    status
  }
}
```

---

## Aggregated metrics for PER_EMPLOYEE

```typescript
async function getEmployeeAggregatedMetrics(
  employeeId: string, 
  periodStart: Date, 
  periodEnd: Date
) {
  // 1. Find all channels employee owns (PRIMARY or SECONDARY)
  const ownerships = await prisma.channelOwnership.findMany({
    where: { 
      employeeId,
      // Ownership phải tồn tại trong period
      assignedAt: { lte: periodEnd }
    },
    select: { channelId: true, role: true, assignedAt: true }
  })
  
  const channelIds = ownerships.map(o => o.channelId)
  
  // 2. Get earliest + latest metrics in period
  const startMetrics = await prisma.channelMetric.findMany({
    where: {
      channelId: { in: channelIds },
      snapshotDate: { gte: periodStart }
    },
    orderBy: { snapshotDate: 'asc' },
    distinct: ['channelId']
  })
  
  const endMetrics = await prisma.channelMetric.findMany({
    where: {
      channelId: { in: channelIds },
      snapshotDate: { lte: periodEnd }
    },
    orderBy: { snapshotDate: 'desc' },
    distinct: ['channelId']
  })
  
  // 3. Calculate deltas
  let followersGain = 0
  let viewsPeriod = 0
  let watchTimeHours = 0
  const engagementRates: number[] = []
  
  for (const channelId of channelIds) {
    const start = startMetrics.find(m => m.channelId === channelId)
    const end = endMetrics.find(m => m.channelId === channelId)
    if (!start || !end) continue
    
    followersGain += (end.followers - start.followers)
    viewsPeriod += (end.viewsPeriod ?? 0)
    watchTimeHours += (end.watchTimeHours ?? 0)
    if (end.engagementRate) engagementRates.push(end.engagementRate)
  }
  
  return {
    followersGain,
    viewsPeriod,
    watchTimeHours,
    avgEngagementRate: engagementRates.length > 0
      ? engagementRates.reduce((a,b) => a+b, 0) / engagementRates.length
      : 0
  }
}
```

---

## Period Helpers

```typescript
import { startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from 'date-fns'

export function getPeriodRange(type: PeriodType, date: Date = new Date()) {
  switch (type) {
    case 'MONTHLY':
      return { start: startOfMonth(date), end: endOfMonth(date) }
    case 'QUARTERLY':
      return { start: startOfQuarter(date), end: endOfQuarter(date) }
    case 'YEARLY':
      return { start: startOfYear(date), end: endOfYear(date) }
  }
}

export function getCurrentPeriod(type: PeriodType) {
  return getPeriodRange(type, new Date())
}

export function getNextPeriod(type: PeriodType, currentEnd: Date) {
  const nextStart = addDays(currentEnd, 1)
  return getPeriodRange(type, nextStart)
}
```

---

## Edge cases

### Nhân viên mới join giữa period
- Option A: Prorate target = target × (days_in_period_after_join / total_days_in_period)
- Option B: KPI mới chỉ áp dụng từ period tiếp theo

Recommended: Option B — đơn giản hơn, công bằng.

### Channel transfer ownership giữa period
- Cũ owner: count metrics đến lúc transfer
- Mới owner: count metrics từ lúc transfer
- Implementation: ChannelOwnership có `assignedAt` + `removedAt` để track time-based ownership

### KPI bị edit target sau khi đã chạy
- Lưu old target vào history table
- Recalculate với target mới
- Notify employee về thay đổi

---

## Performance Optimization

```typescript
// Cache achievement trong KPI table
// Field: achievementPercent, lastCalculatedAt

// Recalc trigger:
// 1. Mỗi ngày 7h sáng (cron job)
// 2. Khi user mở trang KPI detail (nếu lastCalculatedAt > 1h)
// 3. Manual trigger qua API

async function recalculateKPI(kpiId: string) {
  const kpi = await prisma.kPI.findUnique({ where: { id: kpiId } })
  const result = await calculateAchievement(kpi)
  
  await prisma.kPI.update({
    where: { id: kpiId },
    data: {
      achievementPercent: result.achievementPercent,
      status: result.status,
      lastCalculatedAt: new Date()
    }
  })
}

// Bulk recalc daily
@Cron('0 7 * * *')
async dailyKPIRecalc() {
  const tenants = await prisma.tenant.findMany({ 
    where: { status: 'ACTIVE' },
    select: { id: true }
  })
  
  for (const { id: tenantId } of tenants) {
    const kpis = await prisma.kPI.findMany({
      where: { 
        tenantId,
        status: { in: ['IN_PROGRESS', 'NOT_STARTED'] }
      }
    })
    
    // Process in chunks to avoid OOM
    for (const chunk of chunks(kpis, 50)) {
      await Promise.all(chunk.map(k => recalculateKPI(k.id)))
    }
  }
}
```

---

## UI Display Helpers

```typescript
export function getAchievementColor(percent: number): string {
  if (percent < 70) return 'red'
  if (percent < 100) return 'amber'
  if (percent <= 120) return 'green'
  return 'blue' // Exceeded
}

export function getStatusLabel(status: KPIStatus): string {
  return {
    NOT_STARTED: 'Chưa bắt đầu',
    IN_PROGRESS: 'Đang thực hiện',
    ACHIEVED: 'Đạt mục tiêu',
    EXCEEDED: 'Vượt mục tiêu',
    MISSED: 'Không đạt'
  }[status]
}

export function formatTarget(metric: string, value: number): string {
  switch (metric) {
    case 'followers':
    case 'followersGain':
      return value.toLocaleString('vi-VN') + ' followers'
    case 'views':
      return value.toLocaleString('vi-VN') + ' lượt xem'
    case 'watchTime':
      return value.toFixed(1) + ' giờ'
    case 'engagement':
      return value.toFixed(2) + '%'
    default:
      return value.toString()
  }
}
```
