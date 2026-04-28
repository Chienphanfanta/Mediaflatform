# Scheduler Patterns — Media Ops Platform

> Đọc trước khi đụng vào `apps/api/src/modules/queue/`, viết worker mới, hoặc thêm cron schedule.
> Tham chiếu CLAUDE.md §3 (Architecture) cho big picture, §9 rule #13/14 (rate limit + idempotency).

Toàn bộ Phase 7 scheduler stack:

```
apps/api/src/modules/queue/
├── queue.module.ts                     # BullModule.forRootAsync + register 4 queues
├── queues.constants.ts                 # QUEUE_NAMES, WORKER_OPTIONS, JOB_TIMEOUT_MS
├── bull-board.setup.ts                 # /admin/queues UI (basic auth)
├── types/job-types.ts                  # PostPublishJob, AnalyticsSyncJob, AlertCheckJob, NotificationJob
├── services/
│   ├── queue.service.ts                # Facade enqueue helpers + onModuleDestroy
│   ├── cron.service.ts                 # Scheduler post (every minute)
│   ├── analytics-cron.service.ts       # 5 lịch analytics + recompute priority
│   ├── job-log.service.ts              # JobLog DB writes (audit BullMQ events)
│   ├── sync-log.service.ts             # SyncLog DB writes (per-channel sync history)
│   ├── sync-priority.service.ts        # HIGH/NORMAL/LOW recompute
│   ├── youtube-quota.service.ts        # Redis daily counter, threshold-based pause
│   ├── best-time.service.ts            # Best hour per channel (analytics → static fallback)
│   └── queue-monitor.service.ts        # Failure-rate alerts (>100 fails/24h)
└── workers/
    ├── post-publisher.worker.ts        # Phase 1: real publish dispatch + per-platform service
    └── analytics-sync.worker.ts        # Phase 1: real sync + alert engine + notify
```

---

## 1. BullMQ job patterns

### Enqueue qua QueueService (BẮT BUỘC — đừng inject `Queue` trực tiếp)

```ts
import { QueueService } from '@/modules/queue/services/queue.service';

constructor(private readonly queue: QueueService) {}

// Run ngay
await this.queue.enqueuePostPublish({
  postId: 'cuid_...',
  channelId: 'cuid_...',
  platform: 'YOUTUBE',
  scheduledAt: null,                  // null → publish ngay
  idempotencyKey: `publish:${postId}`, // BullMQ jobId — dedup
});

// Scheduled (delay tự tính từ scheduledAt - now)
await this.queue.enqueuePostPublish({
  postId, channelId, platform: 'X',
  scheduledAt: '2026-04-26T14:00:00Z',
  idempotencyKey: `publish:${postId}`,
});

// Priority: dùng options.priority (1 = highest, 10 = lowest)
await this.queue.enqueueAnalyticsSync(data, { priority: 1 });

// Override default attempts/backoff
await this.queue.enqueuePostPublish(data, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 }, // 1m → 2m → 4m → 8m → 16m
});
```

### Repeatable (cron qua BullMQ — multi-instance safe)

```ts
// QueueService đã có scheduleDailyAnalyticsSync — pattern tham chiếu
await queue.add('sync', data, {
  repeat: { pattern: '0 2 * * *' },        // 02:00 UTC daily
  jobId: `daily-sync:${channelId}`,        // dedup repeat key
});

// Remove repeatable
await queue.removeRepeatableByKey('repeat-key-here');
// Hoặc gọn hơn:
await queue.removeRepeatable('sync', { pattern: '0 2 * * *' }, `daily-sync:${id}`);
```

> ⚠️ **Phase 7 vẫn dùng `@nestjs/schedule`** cho cron in-process (xem KNOWN ISSUES #18). Phase 8+ chuyển sang BullMQ repeatable + Redis lock cho multi-instance safety.

---

## 2. Worker error handling

### Cấu trúc worker chuẩn (lifecycle BullMQ + JobLog)

```ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  JOB_TIMEOUT_MS,
  QUEUE_NAMES,
  WORKER_OPTIONS,
} from '../queues.constants';

const QUEUE = QUEUE_NAMES.POST_PUBLISHER;

@Processor(QUEUE, WORKER_OPTIONS[QUEUE])
export class MyWorker extends WorkerHost {
  constructor(private readonly jobLog: JobLogService) { super(); }

  async process(job: Job<MyJobData>): Promise<MyResult> {
    await this.jobLog.logActive(QUEUE, job);
    return runWithTimeout(JOB_TIMEOUT_MS[QUEUE], async () => {
      // ... logic
    });
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job): Promise<void> {
    await this.jobLog.logCompleted(QUEUE, job, job.returnvalue);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error): Promise<void> {
    await this.jobLog.logFailed(QUEUE, job, err);
    // Terminal action chỉ khi exhaust attempts
    const isTerminal = job.attemptsMade >= (job.opts.attempts ?? 3);
    if (isTerminal) await this.markBusinessFailure(job, err);
  }

  @OnWorkerEvent('stalled')
  async onStalled(jobId: string): Promise<void> {
    await this.jobLog.logStalled(QUEUE, jobId);
  }
}

// Per-job timeout (BullMQ không có native job timeout — dùng Promise.race)
function runWithTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Job timeout sau ${ms}ms`)), ms),
    ),
  ]);
}
```

### Backoff strategies

| Use case | Config | Tổng thời gian retry |
|---|---|---|
| Default queue | `{ type: 'exponential', delay: 2000 }` | 2s + 4s + 8s ≈ 14s |
| Post publish (đăng bài) | `{ type: 'exponential', delay: 120_000 }` | 2m + 4m + 8m = 14m |
| Network call retryable | `{ type: 'exponential', delay: 1000 }` + `attempts: 5` | ~30s |
| Webhook process | `{ type: 'fixed', delay: 5000 }` | 5s × N |

> Default trong [queue.module.ts](../../apps/api/src/modules/queue/queue.module.ts): `attempts: 3, backoff: { type: 'exponential', delay: 2000 }`. Override per-enqueue khi cần (xem `cron.service.ts` cho post-publisher 2/4/8 min).

### Dead Letter pattern

BullMQ KHÔNG có DLQ built-in. Có 2 cách:

1. **`removeOnFail: false`** (giữ failed jobs) + Bull Board UI để manual retry. Default queue config giữ failed 7 ngày, max 5000 — đủ cho monitoring.
2. **Manual DLQ** — `onFailed` (terminal) enqueue sang queue `{queue}-dlq` riêng:
   ```ts
   if (isTerminal) {
     await this.dlqQueue.add('dead', { originalData: job.data, error: err.message });
   }
   ```

Hiện tại post-publisher dùng cách 1 + business-level fallback (mark Post REJECTED + tạo Alert HIGH).

### Retryable vs non-retryable errors

```ts
// BasePlatformService.retry() — chỉ retry khi 429 hoặc 5xx
function defaultRetryable(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const obj = e as { status?: number; code?: string };
  if (typeof obj.status === 'number') return obj.status === 429 || obj.status >= 500;
  if (typeof obj.code === 'string')
    return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(obj.code);
  return false;
}

// Trong worker: throw Error với non-retryable code → BullMQ vẫn retry, nhưng
// để tiết kiệm: kiểm tra trong process() và throw `UnrecoverableError`:
import { UnrecoverableError } from 'bullmq';
if (post.deletedAt) throw new UnrecoverableError(`Post ${id} đã xoá`); // ❌ retry skip
```

---

## 3. Cron expression cheatsheet

| Lịch | Expression | Dùng ở | Lưu ý |
|---|---|---|---|
| Mỗi phút | `* * * * *` (= `CronExpression.EVERY_MINUTE`) | [cron.service.ts](../../apps/api/src/modules/queue/services/cron.service.ts) — quét scheduled posts | UTC server |
| Mỗi 15 phút | `*/15 * * * *` | analytics-cron — monetization-building | |
| Mỗi giờ | `0 * * * *` (= `EVERY_HOUR`) | analytics-cron — YT new video | |
| Mỗi giờ + 5 phút offset | `5 * * * *` | analytics-cron — recompute syncPriority | offset để khỏi va với cron khác |
| Mỗi 6 giờ | `0 */6 * * *` (= `EVERY_6_HOURS`) | analytics-cron — sync all active | |
| Daily 07:00 ICT | `0 0 * * *` + `timeZone: 'UTC'` | analytics-cron — daily report | 07:00 ICT = 00:00 UTC |
| Daily 02:00 UTC | `0 2 * * *` | QueueService.scheduleDailyAnalyticsSync | = 09:00 ICT |
| Mỗi 5 phút | `*/5 * * * *` | queue-monitor failure-rate check | |

**Format reminder:** `phút giờ ngày tháng dayOfWeek`. Trong NestJS dùng `CronExpression` enum trước khi tự viết string.

```ts
@Cron(CronExpression.EVERY_HOUR)        // ✅ readable
@Cron('5 * * * *')                       // ✅ chỉ khi cần offset
@Cron('0 0 * * *', { timeZone: 'UTC' })  // ✅ cron có timezone
```

---

## 4. Redis key naming convention

| Prefix | Pattern | Dùng cho |
|---|---|---|
| BullMQ internals | `bull:{queueName}:*` | Queue/Job state — KHÔNG đụng vào tay |
| Rate limit (sync, RL window) | `meta:ig-sync:{channelId}`, `yt:sync-stats:{channelId}` | `RedisService.checkRateLimit()` SET NX EX |
| YouTube quota | `yt:quota:{YYYY-MM-DD}` (UTC) | INCRBY + 36h TTL — [youtube-quota.service.ts](../../apps/api/src/modules/queue/services/youtube-quota.service.ts) |
| Cache analytics | `analytics:{channelId}:summary:{period}` | TTL 1h từ `cached()` wrapper |
| Alert detection debounce | `alerts:detection:debounce` | analytics-sync → run global detection ≤ 1 lần / 5min |
| OAuth state | `oauth:state:{nonce}` | TTL 10min — chỉ dùng nếu không lưu cookie |
| WhatsApp daily counter | `wa:broadcast:{phoneNumberId}:{YYYY-MM-DD}` | Chống vượt cap broadcast |
| Auto-publishing dedup | jobId = `publish:{postId}` | KHÔNG là Redis key thẳng — BullMQ tự tạo `bull:post-publisher:{jobId}` |

> Quy tắc: prefix theo domain (`yt:`, `meta:`, `alerts:`), tách bằng `:`, không dùng `_` hay space, không nhúng JSON. Date dùng `YYYY-MM-DD`.

---

## 5. Idempotency

### Pattern 1 — BullMQ jobId làm dedup key

```ts
// Cron quét + enqueue. Nếu job với cùng id đã có → BullMQ throw (skip)
const idempotencyKey = `publish:${post.id}`;
await queue.add('publish', data, { jobId: idempotencyKey });

// Hoặc kèm date để key unique theo ngày:
const jobId = `daily-sync:${channelId}:${dateYYYYMMDD}`;
```

### Pattern 2 — DB-level guard trước khi gọi external API

```ts
// post-publisher.worker.ts — check externalId trong metadata trước khi POST
const meta = (post.metadata ?? {}) as Record<string, unknown>;
if (typeof meta.externalId === 'string') {
  this.logger.log(`Post ${id} đã có externalId — skip duplicate publish`);
  return { status: 'skipped', externalPostId: meta.externalId };
}
// ... gọi platform → lưu externalId vào metadata
```

### Pattern 3 — Cron-level "queuedJobId" cờ

```ts
// SchedulerCronService — đánh dấu post đã enqueue ở tick trước
if (typeof meta.queuedJobId === 'string') continue; // skip — đã queued

const jobId = await queue.enqueuePostPublish(data, { ... });
await prisma.post.update({
  where: { id: post.id },
  data: {
    metadata: { ...meta, queuedJobId: jobId, queuedAt: new Date().toISOString() },
  },
});
```

> ⚠️ Đừng tin BullMQ jobId-only nếu cron chạy mỗi phút và job có delay > 1 phút — rare race tạo duplicate. Pattern 3 là extra guard ở DB.

---

## 6. Testing jobs locally

### Trigger manual (dev)

```ts
// Bất kỳ controller / repl: inject QueueService + add job
import { QueueService } from '@/modules/queue/services/queue.service';

@Post('debug/trigger-publish')
async trigger(@Body() body: { postId: string }, @Inject() queue: QueueService) {
  return queue.enqueuePostPublish({
    postId: body.postId,
    channelId: 'cuid_...',
    platform: 'YOUTUBE',
    scheduledAt: null,
    idempotencyKey: `publish:${body.postId}:debug`,
  });
}
```

Hoặc qua `/admin/queues` Bull Board UI: `Add job` button cho phép paste JSON payload.

### Mock platform API responses

Hai cách:

1. **Override env trỏ sang mock server** (msw, prism, hoặc Express stub):
   ```bash
   YOUTUBE_API_BASE=http://localhost:5000 npm run dev
   ```
   Mock server return shape giống Google API.

2. **Mock service ở constructor inject** (test):
   ```ts
   const mockYT = { uploadVideo: jest.fn().mockResolvedValue({ videoId: 'abc' }) };
   const worker = new PostPublisherWorker(prisma, jobLog, mockYT, ..., ..., ...);
   await worker.process(fakeJob);
   expect(mockYT.uploadVideo).toHaveBeenCalledOnce();
   ```

### Run worker isolated (no Nest bootstrap)

Phù hợp khi debug 1 worker không muốn boot full app:

```ts
// scripts/run-publisher-once.ts
import { Queue } from 'bullmq';
const q = new Queue('post-publisher', { connection: { url: process.env.REDIS_URL! } });
await q.add('publish', { postId: 'xxx', ... }, { jobId: 'manual-test-1' });
await q.close();
```

Sau đó chạy app NestJS normal — worker pickup job duy nhất → quan sát log.

### Inspect failed jobs

- Bull Board: `http://localhost:4000/admin/queues` (basic auth `BULL_BOARD_USER`/`BULL_BOARD_PASS`)
- Web UI: `/settings/queues` (SUPERADMIN) — cards + table + retry/delete inline
- DB: `SELECT * FROM "JobLog" WHERE status='FAILED' ORDER BY "createdAt" DESC LIMIT 50;`
- Per-channel sync history: `SELECT * FROM "SyncLog" WHERE "channelId" = ? ORDER BY "createdAt" DESC;`

---

## 7. Graceful shutdown pattern

NestJS gọi `OnApplicationShutdown` khi nhận SIGTERM/SIGINT — phải `app.enableShutdownHooks()` trong [main.ts](../../apps/api/src/main.ts) để hooks fire.

### Order tắt (đã implement)

```
SIGTERM (Docker stop, pod scale-down)
  ↓
NestFactory.create(...).enableShutdownHooks()
  ↓
1. WorkerHost.onModuleDestroy()        — tự động: BullMQ dừng pickup job mới, chờ active jobs xong
2. QueueService.onModuleDestroy()      — đóng Queue (producer) connections
3. RedisService.onModuleDestroy()      — quit ioredis client
4. PrismaService.onModuleDestroy()     — disconnect Prisma
5. QueueModule.onApplicationShutdown   — log signal nhận được
```

### Implement custom shutdown hook

```ts
@Injectable()
export class MyService implements OnModuleDestroy {
  async onModuleDestroy() {
    // Drain in-flight: chờ tasks queue rỗng, max 30s
    await Promise.race([
      this.drainPending(),
      new Promise((r) => setTimeout(r, 30_000)),
    ]);
  }
}
```

### Production caveats

- **Kubernetes**: set `terminationGracePeriodSeconds: 60` (mặc định 30s không đủ cho `JOB_TIMEOUT_MS.ANALYTICS_SYNC = 60s`).
- **Docker Compose**: `stop_grace_period: 60s`.
- **Long-running jobs**: nếu job > grace period → bị kill mid-flight. BullMQ sẽ mark stalled khi worker không heartbeat → re-pickup ở instance khác. Worker phải idempotent (xem §5).
- **Webhook handlers**: trả 200 trong < 5s, đẩy việc nặng vào queue — đảm bảo shutdown không kéo theo dropped webhooks.

### Lock cron jobs khi đang shutdown

`SchedulerCronService` + `AnalyticsCronService` dùng in-process `Map<string, boolean>` lock. Khi worker shutdown, cron tick mới không pickup. Đủ cho Phase 7 (1 instance). Phase 8 multi-pod cần Redis lock (`SET NX EX`).

---

## Quick refs

- **4 queues + concurrency**: `[post-publisher: 2, analytics-sync: 5 (10/min), alert-checker: 3, notification-sender: 10 (100/min)]` — xem [queues.constants.ts](../../apps/api/src/modules/queue/queues.constants.ts)
- **Job log → JobLog table**, **per-channel sync log → SyncLog table** (xem `services/*-log.service.ts`)
- **Redis quota**: `yt:quota:{date}` 36h TTL — pause non-critical sync ở 80%, alert CRITICAL ở 99%
- **Bull Board** `/admin/queues` (apps/api) — basic auth env-gated
- **Queue monitor UI** `/settings/queues` (apps/web) — SUPERADMIN, real-time + 24h timeline
- **AlertEngine sau sync**: `alertEngine.checkConditions(channelId)` per-channel — `runDetection()` global vẫn chạy hourly cron
