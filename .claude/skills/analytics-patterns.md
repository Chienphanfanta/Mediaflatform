# Analytics Patterns — Media Ops Platform

> Đọc trước khi viết bất kỳ logic analytics nào (metric aggregation, chart, export, alert detection).
> Tham chiếu CLAUDE.md §6 cho thresholds platform-specific.

---

## 1. Growth rate — công thức chuẩn

```ts
function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null; // tránh chia 0 / Infinity
  return ((current - previous) / previous) * 100;
}
```

Quy tắc:
- **Trả `null` khi `previous <= 0`** — UI render `—` thay vì `+∞%`. Đừng default về 0%.
- **Round 1-2 chữ số** ở response (FE format). Tránh `12.345678901234%` lộ noise.
- **Engagement dùng AVG, không SUM** trong compare period — sum các % là vô nghĩa.
- **Subscribers dùng `subscriberDelta`** (số tăng ròng) khi tính growth, không phải absolute `subscribers` (luôn tăng, vô nghĩa).

Ví dụ thực tế: [api/v1/analytics/overview/route.ts](../../apps/web/src/app/api/v1/analytics/overview/route.ts), [analytics-service.ts](../../apps/web/src/lib/analytics-service.ts).

```ts
// helper trong analytics overview endpoint
function delta(cur: number, prev: number): MetricDelta {
  const d = cur - prev;
  return {
    current: r2(cur),
    previous: r2(prev),
    delta: r2(d),
    deltaPct: prev > 0 ? r2((d / prev) * 100) : null,
  };
}
```

UI hiển thị (xem [format.ts](../../apps/web/src/lib/format.ts)):
```ts
function formatPct(n: number | null): string {
  if (n === null || !isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}
```

---

## 2. Recharts patterns

### 2.1 Dual axis chart (Views + Watch Time)

Dùng `ComposedChart` khi 2 metric khác đơn vị (số đếm vs giờ):

```tsx
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

<ResponsiveContainer width="100%" height={300}>
  <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
    <XAxis
      dataKey="name"
      tickFormatter={(d) => format(parseISO(d), 'dd/MM')}
      minTickGap={20}
      tick={{ fontSize: 11 }}
    />
    {/* Trục TRÁI cho Views — match với Area color */}
    <YAxis yAxisId="left" tickFormatter={formatCompact} stroke="#3b82f6" />
    {/* Trục PHẢI cho Watch Time — match với Line color */}
    <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}h`} stroke="#8b5cf6" />
    <Tooltip {...tooltipStyle} />
    <Legend />
    <Area yAxisId="left" type="monotone" dataKey="views" fill="#3b82f6" fillOpacity={0.18} stroke="#3b82f6" strokeWidth={2} />
    <Line yAxisId="right" type="monotone" dataKey="watchTime" stroke="#8b5cf6" strokeWidth={2} dot={false} />
  </ComposedChart>
</ResponsiveContainer>
```

**Quan trọng**: `yAxisId="left"` / `"right"` phải match giữa `<YAxis>` và `<Line>`/`<Area>`. Quên = chart vẽ sai.

Ví dụ thật: [tab-overview.tsx](../../apps/web/src/components/analytics/channel/tab-overview.tsx).

### 2.2 Custom tooltip styled theo theme

Recharts tooltip mặc định không match dark mode. Ghi đè `contentStyle`:

```tsx
<Tooltip
  contentStyle={{
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
  }}
  labelFormatter={(d: string) => format(parseISO(d), 'EEEE, dd/MM/yyyy', { locale: vi })}
  formatter={(value: number, name: string) => [
    formatCompact(value),
    PLATFORM_LABEL[name as Platform] ?? name,
  ]}
/>
```

CSS vars `--popover` và `--border` đã có sẵn trong [globals.css](../../apps/web/src/app/globals.css) — tự động đổi theo light/dark theme.

### 2.3 ResponsiveContainer — bắt buộc

**Luôn** wrap chart trong `<ResponsiveContainer width="100%" height={...}>`. Không dùng width/height fix trên chart trực tiếp:

```tsx
// ❌ Sai — không responsive
<LineChart width={600} height={300} data={data}>...</LineChart>

// ✅ Đúng
<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data}>...</LineChart>
</ResponsiveContainer>
```

`height` phải là số (không phải `'100%'`) trừ khi container cha có chiều cao xác định.

### 2.4 Toggle hiện/ẩn series qua state

Pattern thấy trong [views-chart.tsx](../../apps/web/src/components/analytics/views-chart.tsx):

```tsx
const [hidden, setHidden] = useState<Set<string>>(new Set());

// Render Line CHỈ KHI không bị hidden — đừng dùng `style.display: none`
{datasets.map((ds) =>
  hidden.has(ds.label) ? null : (
    <Line key={ds.label} dataKey={ds.label} stroke={ds.color} ... />
  ),
)}

// Checkbox tách riêng để toggle
<Checkbox
  checked={!hidden.has(ds.label)}
  onCheckedChange={() => toggleSet(setHidden, ds.label)}
/>
```

Không dùng built-in Recharts Legend `onClick` — khó style theo design.

### 2.5 Pivot ChartData (Chart.js style) → Recharts shape

Analytics service trả `{ labels, datasets }` (Chart.js style). Recharts cần array of objects:

```ts
// Helper sẵn có trong lib/analytics-service.ts
export function toRechartsData(chart: ChartData) {
  return chart.labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label };
    for (const ds of chart.datasets) row[ds.label] = ds.data[i] ?? 0;
    return row;
  });
}
```

Rồi chart dùng `dataKey="Views"`, `dataKey="Revenue ($)"` (chính là `ds.label`).

---

## 3. Date range handling

### 3.1 Luôn dùng `date-fns` — không dùng moment / dayjs

Đã cài `date-fns@3` + `date-fns/locale/vi`. Pattern:

```ts
import { startOfDay, subDays, addDays, format, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';

// Range cho period preset
function rangeFromPeriod(period: '7d' | '30d' | '90d') {
  const to = startOfDay(new Date());
  const days = { '7d': 7, '30d': 30, '90d': 90 }[period];
  const from = subDays(to, days - 1); // -1 vì inclusive cả ngày `to`
  return { from, to };
}

// Compare period (so kỳ trước cùng độ dài)
const prevTo = subDays(curFrom, 1);
const prevFrom = subDays(prevTo, days - 1);

// Format VI cho UI
format(date, 'dd/MM/yyyy', { locale: vi });
format(date, "EEEE, dd 'tháng' MM/yyyy", { locale: vi });
formatDistanceToNow(date, { addSuffix: true, locale: vi });
```

### 3.2 Timezone: Asia/Ho_Chi_Minh — quy ước

**Server**: dùng UTC nội bộ (Postgres lưu UTC). Khi parse từ user input timezone-aware, convert sang UTC trước khi query.

**Client**: hiển thị theo timezone trình duyệt (mặc định) — hầu hết user VN sẽ thấy giờ VN. Format không cần explicit timezone.

**Cron (NestJS)**: `@nestjs/schedule` chạy theo timezone của server. Production deploy nên set `TZ=Asia/Ho_Chi_Minh` trong env hoặc Docker:
```yaml
environment:
  TZ: Asia/Ho_Chi_Minh
```

**Khi cần convert explicit** (ví dụ daily snapshot phải tính theo "00:00 GMT+7"):

```ts
// Cách đơn giản: bù 7 giờ thủ công
function startOfVNDay(d: Date): Date {
  const utcMidnight = startOfDay(d);
  utcMidnight.setUTCHours(-7); // 00:00 GMT+7 = 17:00 UTC ngày trước
  return utcMidnight;
}

// Hoặc dùng Intl với timezone
const formatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric', month: '2-digit', day: '2-digit',
});
```

`Analytics.date` có type `@db.Date` (date only, không timestamp) → quy ước "ngày X" theo timezone server. Các snapshot fetch từ platform API thường trả theo PT (YouTube) hoặc UTC (FB) → convert tại integration layer trước khi insert.

### 3.3 Fill missing days trong chart

Nếu Analytics không có row cho ngày X → chart sẽ skip → graph nhảy. Phải fill 0:

```ts
function fillDailyLabels(from: Date, to: Date): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to) {
    out.push(format(d, 'yyyy-MM-dd'));
    d = addDays(d, 1);
  }
  return out;
}

// Sau đó merge analytics rows vào array đã fill 0
const labels = fillDailyLabels(from, to);
const labelIdx = new Map(labels.map((l, i) => [l, i]));
const data = new Array(labels.length).fill(0);
for (const r of rows) {
  const i = labelIdx.get(format(r.date, 'yyyy-MM-dd'));
  if (i !== undefined) data[i] = r.value;
}
```

---

## 4. Caching strategy

Stack: **Redis** (qua `lib/redis.ts`) + **React Query** (FE) + **Prisma raw** (no cache).

### 4.1 TTL guideline

| Loại data | TTL | Lý do |
|-----------|-----|-------|
| Daily metrics (Analytics) | **1 giờ** | Cron fetch hourly; FE chấp nhận 1h lag |
| Top posts | 30 phút | Engagement biến động ngắn hạn |
| Growth rate (period compare) | **1 giờ** | Tính từ daily metrics → cùng TTL |
| Revenue estimate | **6 giờ** | AdSense data lag ~24-48h, không cần fresh |
| Historical / completed periods | **24 giờ** | Data đã đóng băng, không thay đổi |
| User session permissions | (JWT 7 ngày) | Embed trong token, không Redis |

Constants thực tế: [analytics-service.ts](../../apps/web/src/lib/analytics-service.ts):
```ts
const TTL = {
  METRICS: 60 * 60,       // 1h
  TOP_POSTS: 30 * 60,     // 30min
  REVENUE: 6 * 60 * 60,   // 6h
  GROWTH: 60 * 60,        // 1h
} as const;
```

### 4.2 Cache wrapper pattern (graceful fallback)

```ts
import { cached } from '@/lib/redis';

export async function getChannelMetrics(channelId: string, range: DateRange) {
  return cached(
    cacheKey(['chan-metrics', channelId, isoDate(range.from), isoDate(range.to)]),
    TTL.METRICS,
    async () => {
      // Loader: query Prisma
      return prisma.analytics.findMany({ ... });
    },
  );
}
```

`cached()` (xem [lib/redis.ts](../../apps/web/src/lib/redis.ts)):
- Redis miss/down → vẫn chạy loader → trả data
- Set fire-and-forget (không chặn response)
- Không throw nếu Redis chậm/timeout

### 4.3 Cache key — ổn định, có version

```ts
const CACHE_VERSION = 'v1';
const CACHE_PREFIX = `media-ops:${CACHE_VERSION}:analytics`;

function cacheKey(parts: Array<string | number | string[] | null>): string {
  return [
    CACHE_PREFIX,
    ...parts.map((p) => Array.isArray(p) ? p.slice().sort().join(',') : String(p)),
  ].join(':');
}
```

- **Sort array params** trước concat: `[ch1, ch2]` và `[ch2, ch1]` → cùng key (cache hit chéo)
- **Bump version** khi thay shape response → invalidate hàng loạt mà không cần `FLUSHALL`
- **Invalidate có chủ đích**: `invalidatePattern('media-ops:v1:analytics:chan-metrics:ch123:*')` qua SCAN

### 4.4 Khi KHÔNG nên cache

- Mutation responses (POST/PATCH/DELETE) — không cache
- Permission check (đã cache trong JWT)
- Realtime data (notifications) — chấp nhận polling 60s thay vì cache

### 4.5 React Query staleTime tương ứng

FE cache match BE TTL để giảm requests:

```ts
useQuery({
  queryKey: ['analytics-summary', state],
  queryFn: ...,
  staleTime: 5 * 60_000,         // 5 phút — UX
  refetchOnWindowFocus: false,   // tránh fetch lại khi user switch tab
});

// Polling (notifications)
useQuery({
  queryKey: ['alerts-bell'],
  queryFn: ...,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false, // pause khi tab inactive
});
```

---

## 5. Watch Time monetization thresholds

Constants — **DO NOT change without YouTube policy update**:

```ts
const YT_WATCH_THRESHOLD_HOURS = 4_000; // /12 tháng
const YT_SUBS_THRESHOLD = 1_000;
const YT_SHORTS_VIEWS_THRESHOLD = 10_000_000; // /90 ngày (alternative path)
```

### 5.1 Yearly estimate from period

Khi user chỉ có data 30 ngày, ước tính cả năm:

```ts
const yearlyEstimate = days > 0 ? (totalWatchHours * 365) / days : 0;
const progressPct = (yearlyEstimate / 4000) * 100;
```

UI [tab-monetization.tsx](../../apps/web/src/components/analytics/channel/tab-monetization.tsx) hiển thị bar đổi màu emerald khi ≥100%.

### 5.2 Status logic

```ts
type MonetizationStatus = 'APPROVED' | 'UNDER_REVIEW' | 'NOT_MONETIZED' | 'DEMONETIZED';

function determineStatus(channel: Channel, yearlyEstimate: number, latestSubs: number): MonetizationStatus {
  const meta = channel.metadata as { monetizationEnabled?: boolean };
  if (meta?.monetizationEnabled === true) return 'APPROVED';
  if (yearlyEstimate >= 4000 && latestSubs >= 1000) return 'UNDER_REVIEW';
  return 'NOT_MONETIZED';
  // DEMONETIZED: cần signal từ webhook YouTube — Phase 1
}
```

### 5.3 At-risk detection (alert)

[alerts.service.ts](../../apps/api/src/modules/alerts/alerts.service.ts) `detectMonetizationAtRisk()`:

```ts
// Cảnh báo trước 2 tháng nếu watch time chỉ đạt 75% threshold (3000h/4000h)
// hoặc subs chưa đạt 80% (800/1000)
const subsAtRisk = latestSubs < 800;
const watchAtRisk = yearlyEstimate < 3000;
if (subsAtRisk || watchAtRisk) {
  alerts.create({ type: 'MONETIZATION_AT_RISK', severity: 'HIGH', ... });
}
```

Dedup 72h (không spam) — xem §4.2 alert-patterns.

### 5.4 Lưu ý quan trọng

- **Watch time tính trên video PUBLIC** — private/unlisted không count
- **Subscriber threshold dùng absolute** (lúc check), không phải tăng trưởng
- **Reset rolling**: 12 tháng = 365 ngày tính ngược từ hiện tại (sliding window)
- **Shorts tách riêng**: 10M views/90 ngày là đường vào riêng — chưa implement

---

## 6. Alert severity matrix

Schema enum: `LOW | MEDIUM | HIGH | CRITICAL` (xem [schema.prisma](../../packages/db/prisma/schema.prisma)).

| Severity | Khi nào | Hành động UI |
|----------|---------|---------------|
| **LOW** (xám) | Info-level, không gấp. Vd: `CHANNEL_INACTIVE` (kênh không post 7 ngày), `TOKEN_EXPIRING > 14 ngày` | Hiện trong list, không ping bell màu |
| **MEDIUM** (vàng) | Cần chú ý nhưng không blocker. Vd: `VIEW_DROP` (giảm 30%), `DEADLINE_APPROACHING` (task 24h), `TOKEN_EXPIRING < 7 ngày` | Bell badge bình thường |
| **HIGH** (cam) | Ảnh hưởng nghiệp vụ ngay. Vd: `MONETIZATION_AT_RISK`, `SCHEDULED_POST_FAILED`, `TOKEN_EXPIRED` | Bell highlight, có thể email/push notification |
| **CRITICAL** (đỏ) | Blocker / pháp lý / mất tài sản. Vd: `COPYRIGHT_STRIKE`, `MONETIZATION_LOST`, `API_ERROR` mass failure | Bell pulse + popup + thông báo all admin |

### Quy tắc upgrade severity

- **Lặp lại** không tăng severity (idempotency dedup 24-72h xử lý)
- **Cộng dồn impact**: 5 channels cùng VIEW_DROP → có thể nâng từ MEDIUM → HIGH (ví dụ aggregate alert riêng)
- **Auto-downgrade**: alert MONETIZATION_AT_RISK → khi đạt threshold → mark READ + tạo alert mới INFO `MONETIZATION_RECOVERED` (Phase 1)

### Style mapping (FE)

```ts
// lib/alerts-style.ts
SEVERITY_COLOR.LOW      = { dot: 'bg-slate-400', bar: 'bg-slate-400', badge: 'bg-muted ...' };
SEVERITY_COLOR.MEDIUM   = { dot: 'bg-amber-500', bar: 'bg-amber-500', badge: 'bg-amber-500/10 ...' };
SEVERITY_COLOR.HIGH     = { dot: 'bg-orange-500', bar: 'bg-orange-500', badge: 'bg-orange-500/10 ...' };
SEVERITY_COLOR.CRITICAL = { dot: 'bg-destructive', bar: 'bg-destructive', badge: 'bg-destructive/10 ...' };
```

Xem [lib/alerts-style.ts](../../apps/web/src/lib/alerts-style.ts) cho mapping đầy đủ + Vietnamese label.

---

## 7. Export patterns

### 7.1 CSV

**Implementation hiện tại** (no extra dep): manual escape + UTF-8 BOM. Đủ cho mọi report shape.

```ts
// lib/reports/csv.ts (project pattern)
const BOM = '﻿'; // ﻿ — Excel mới mở UTF-8 đúng tiếng Việt

function escape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRows(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n');
}
```

Response từ route handler:
```ts
return new NextResponse('﻿' + csv, {
  headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="report-${stamp}.csv"`,
    'Cache-Control': 'no-store',
  },
});
```

**Khi nào dùng `papaparse` thay vì manual:**
- **Parse CSV vào** (user upload CSV file) — manual không robust
- **Streaming write** > 100k rows — manual sẽ allocate string lớn
- Cần auto-detect delimiter (`,` vs `;` vs tab)

Cài: `npm i papaparse @types/papaparse -w @media-ops/web`

```ts
import Papa from 'papaparse';

// Output
const csv = Papa.unparse(rows, { header: true });

// Streaming parse (browser hoặc Node)
Papa.parse(file, {
  header: true,
  step: (row) => processRow(row),
  complete: () => done(),
});
```

Không cần papaparse cho output đơn giản — manual sạch hơn và 0 deps.

### 7.2 PDF — `@react-pdf/renderer`

Server-side render qua `renderToBuffer`. Pattern thực tế: [lib/reports/pdf.tsx](../../apps/web/src/lib/reports/pdf.tsx).

```tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica' },
  table: { borderTop: '1 solid #E2E8F0' },
  tr: { flexDirection: 'row', borderBottom: '1 solid #E2E8F0', paddingVertical: 4 },
  trHeader: { backgroundColor: '#F8FAFC', fontWeight: 700 },
});

function ReportPdf({ data }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={{ fontSize: 20 }}>Report Title</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHeader]}>
            <Text style={{ width: '60%' }}>Title</Text>
            <Text style={{ width: '40%', textAlign: 'right' }}>Views</Text>
          </View>
          {data.rows.map((r, i) => (
            <View key={r.id} style={styles.tr} wrap={false}>
              ...
            </View>
          ))}
        </View>
        <Text fixed render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} / ${totalPages}`
        } />
      </Page>
    </Document>
  );
}

const buffer = await renderToBuffer(<ReportPdf data={data} />);
```

**Buffer → Response** (TypeScript strict không cho Buffer trực tiếp):
```ts
const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
return new NextResponse(blob, { headers: { ... } });
```

### 7.3 Quy tắc khi viết PDF template

- **Style array không nhận `false`** — extract helper trả object luôn:
  ```ts
  function deltaColor(d: number | null) {
    if (typeof d !== 'number') return {};
    return d > 0 ? { color: '#10B981' } : d < 0 ? { color: '#EF4444' } : {};
  }
  // Dùng: <Text style={[styles.td, deltaColor(c.delta)]}>
  ```

- **`wrap={false}` trên row** để không split row giữa pages
- **Header/Footer fixed**: thuộc tính `fixed` lặp trên mọi page
- **Page numbers**: `Text fixed render={({ pageNumber, totalPages }) => ...}`
- **Cap rows trong PDF** (vd 200 posts) + ghi chú "Use CSV for full list" — PDF hàng nghìn rows render chậm + file lớn

### 7.4 Vietnamese diacritics — limitation

Helvetica mặc định **không support** đầy đủ tiếng Việt → ký tự có dấu render thiếu glyphs (`ê`, `ơ`, `ư`...).

Phase 1 fix: register Roboto/Inter từ CDN ttf:
```ts
import { Font } from '@react-pdf/renderer';

Font.register({
  family: 'Roboto',
  src: 'https://cdn.jsdelivr.net/gh/google/fonts/apache/roboto/static/Roboto-Regular.ttf',
});

const styles = StyleSheet.create({
  page: { fontFamily: 'Roboto', ... }, // ← thay Helvetica
});
```

Lưu ý: lần render đầu tiên fetch font qua HTTP (~2s). Cache trong `/tmp` cho subsequent calls.

### 7.5 Endpoint pattern

```ts
// POST /api/v1/reports/generate
export const POST = withAuth(
  async ({ req, user }) => {
    if (!meetsRole(user, 'MANAGER')) return fail('FORBIDDEN', ..., 403);
    const input = generateReportSchema.parse(await req.json());
    const data = await generateReport(input, user);

    if (input.format === 'JSON') return ok(data);
    if (input.format === 'CSV') {
      return new NextResponse(reportToCsv(data), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': '...' },
      });
    }
    // PDF — dynamic import để tránh bundle nặng vào edge build
    const { reportToPdfBuffer } = await import('@/lib/reports/pdf');
    const buffer = await reportToPdfBuffer(data);
    return new NextResponse(new Blob([new Uint8Array(buffer)]), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': '...' },
    });
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } }, // PDF render nặng — limit thấp
);
```

### 7.6 Client trigger download

POST → fetch blob → tạo `<a download>` ảo:

```ts
async function downloadReport(input: ReportInput, format: 'PDF' | 'CSV') {
  const res = await fetch('/api/v1/reports/generate', {
    method: 'POST',
    body: JSON.stringify({ ...input, format }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report.${format.toLowerCase()}`;
  a.click();
  URL.revokeObjectURL(url);
}
```

Xem [reports/page.tsx](../../apps/web/src/app/(dashboard)/reports/page.tsx) cho ví dụ đầy đủ.

---

## 8. Anti-patterns — đừng làm

| ❌ | ✅ |
|----|----|
| Tính growth `(cur - prev) / prev` không check `prev > 0` | Luôn return `null` khi prev ≤ 0 |
| Sum engagement rate qua nhiều ngày | AVG khi compare period |
| Cache permission map trong service-side memory | Embed trong JWT khi login |
| Cache key không sort array param | Sort trước concat → tận dụng cache hit chéo |
| `JSON.stringify(date)` rồi cache | Dùng `format(date, 'yyyy-MM-dd')` — stable, ngắn |
| Render Recharts không có `ResponsiveContainer` | Luôn wrap |
| Render PDF tất cả posts (10k+) | Cap 200 + note "Use CSV" |
| `console.log` token trong integration code | Mask: `token.slice(0, 8) + '...'` |
| Cron alert detection không dedup | `createIfNoneRecent(input, dedupHours)` |
| Hardcode "WARNING" string | `AlertSeverity.MEDIUM` enum import |
