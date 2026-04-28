# Skill: Analytics Patterns — Media Ops Platform

> Đọc file này trước khi làm bất kỳ thứ gì liên quan đến analytics, charts, hoặc metrics.

---

## Timezone — Quan trọng nhất

```typescript
// LUÔN dùng Asia/Ho_Chi_Minh cho tất cả date operations
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz'

const VN_TZ = 'Asia/Ho_Chi_Minh'

// Convert UTC (DB) → VN time để hiển thị
const displayDate = toZonedTime(utcDate, VN_TZ)

// Convert VN time → UTC trước khi lưu DB
const utcDate = fromZonedTime(vnDateString, VN_TZ)

// "Hôm nay" theo giờ VN
const todayVN = toZonedTime(new Date(), VN_TZ)
const startOfTodayVN = startOfDay(todayVN)
```

---

## Growth Rate Calculation

```typescript
// Cách tính đúng — tránh NaN và Infinity
export function calcGrowthRate(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100 * 10) / 10 // 1 decimal
}

// Usage:
const growthRate = calcGrowthRate(todayViews, yesterdayViews)
// → "+15.3%" hoặc "-8.2%"

// Display helper
export function formatGrowth(rate: number): { text: string; positive: boolean } {
  return {
    text: `${rate > 0 ? '+' : ''}${rate}%`,
    positive: rate >= 0
  }
}
```

---

## Period Helpers

```typescript
import { subDays, subMonths, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns'

export function getPeriodRange(period: '7d' | '30d' | '90d' | 'custom', customFrom?: Date, customTo?: Date) {
  const now = new Date()
  const ranges = {
    '7d':  { from: startOfDay(subDays(now, 6)), to: endOfDay(now) },
    '30d': { from: startOfDay(subDays(now, 29)), to: endOfDay(now) },
    '90d': { from: startOfDay(subMonths(now, 3)), to: endOfDay(now) },
    'custom': { from: customFrom!, to: customTo! }
  }
  return ranges[period]
}

// Lấy previous period để so sánh
export function getPreviousPeriod(from: Date, to: Date) {
  const duration = to.getTime() - from.getTime()
  return {
    from: new Date(from.getTime() - duration),
    to: new Date(from.getTime() - 1)
  }
}

// Tạo labels ngày cho chart
export function getDateLabels(from: Date, to: Date): string[] {
  return eachDayOfInterval({ start: from, end: to })
    .map(d => format(d, 'dd/MM', { timeZone: VN_TZ }))
}
```

---

## Recharts Patterns — Copy-paste ready

### Dual-axis Line Chart (Views + Watch Time)

```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 500 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ margin: '2px 0', color: p.color }}>
          {p.name}: {p.value.toLocaleString('vi-VN')}
        </p>
      ))}
    </div>
  )
}

<ResponsiveContainer width="100%" height={320}>
  <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary)" />
    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
    <Tooltip content={<CustomTooltip />} />
    <Legend wrapperStyle={{ fontSize: 12 }} />
    <Line yAxisId="left"  type="monotone" dataKey="views"         stroke="#E24B4A" strokeWidth={2} dot={false} name="Lượt xem" />
    <Line yAxisId="right" type="monotone" dataKey="watchTimeHours" stroke="#1D9E75" strokeWidth={2} dot={false} name="Giờ xem" />
  </LineChart>
</ResponsiveContainer>
```

### Platform colors — dùng nhất quán

```typescript
export const PLATFORM_COLORS = {
  YOUTUBE:   '#E24B4A',
  FACEBOOK:  '#378ADD',
  INSTAGRAM: '#D4537E',
  X:         '#888780',
  TELEGRAM:  '#1D9E75',
  WHATSAPP:  '#639922',
}

export const PLATFORM_LABELS = {
  YOUTUBE:   'YouTube',
  FACEBOOK:  'Facebook',
  INSTAGRAM: 'Instagram',
  X:         'X (Twitter)',
  TELEGRAM:  'Telegram',
  WHATSAPP:  'WhatsApp',
}
```

---

## Watch Time Monetization Thresholds (YouTube)

```typescript
export const YOUTUBE_MONETIZATION = {
  WATCH_TIME_HOURS_REQUIRED: 4000,  // trong 12 tháng qua
  SUBSCRIBERS_REQUIRED: 1000,
  
  // Tính % progress
  calcWatchTimeProgress(hoursLast12Months: number): number {
    return Math.min(100, Math.round((hoursLast12Months / 4000) * 100))
  },
  
  // Ước tính bao nhiêu ngày nữa đạt mục tiêu
  estimateDaysToGoal(currentHours: number, avgDailyHours: number): number | null {
    const remaining = 4000 - currentHours
    if (remaining <= 0) return 0
    if (avgDailyHours <= 0) return null
    return Math.ceil(remaining / avgDailyHours)
  }
}
```

---

## Redis Caching Strategy

```typescript
import { redis } from '@/lib/redis'

// Cache key patterns
const CACHE_KEYS = {
  channelMetrics: (channelId: string, period: string) => `metrics:${channelId}:${period}`,
  overviewSummary: (groupId: string, period: string) => `overview:${groupId}:${period}`,
  topPosts: (channelId: string) => `top-posts:${channelId}`,
}

// Cache TTLs (seconds)
const TTL = {
  metrics: 3600,      // 1 giờ
  overview: 1800,     // 30 phút
  historical: 86400,  // 24 giờ (dữ liệu quá khứ không đổi)
  revenue: 21600,     // 6 giờ
}

// Pattern: cache-aside
async function getCachedOrFetch<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = await redis.get(key)
  if (cached) return JSON.parse(cached)
  
  const data = await fetcher()
  await redis.setex(key, ttl, JSON.stringify(data))
  return data
}
```

---

## Alert Severity Matrix

| Điều kiện                              | Severity  | Action                    |
|----------------------------------------|-----------|---------------------------|
| View hôm nay < 40% trung bình 7 ngày  | CRITICAL  | Push notification ngay    |
| View hôm nay < 70% trung bình 7 ngày  | HIGH      | In-app + Email            |
| Watch time < 3000h còn 2 tháng        | HIGH      | In-app + Email            |
| Subscribers < 800                      | MEDIUM    | In-app                    |
| Không đăng bài > 14 ngày              | MEDIUM    | In-app                    |
| Token expires trong < 7 ngày          | HIGH      | In-app + Email            |
| Scheduled post failed                  | HIGH      | Push + Email              |
| Task deadline trong 2 giờ             | MEDIUM    | Push notification         |
| Channel inactive > 7 ngày             | LOW       | In-app                    |

---

## CSV Export với Papa Parse

```typescript
import Papa from 'papaparse'

export function exportAnalyticsToCSV(data: Analytics[], filename: string) {
  const rows = data.map(row => ({
    'Ngày': format(row.date, 'dd/MM/yyyy'),
    'Kênh': row.channel.name,
    'Nền tảng': row.platform,
    'Lượt xem': row.views,
    'Giờ xem': row.watchTimeHours.toFixed(1),
    'Subscribers mới': row.subscriberDelta,
    'Doanh thu (VND)': Math.round(row.revenue * 25000), // USD → VND
    'Engagement Rate': `${row.engagementRate.toFixed(2)}%`,
  }))

  const csv = Papa.unparse(rows, { quotes: true })
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }) // BOM cho Excel
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}_${format(new Date(), 'yyyyMMdd')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```
