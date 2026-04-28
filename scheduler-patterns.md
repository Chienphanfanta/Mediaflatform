# Skill: Scheduler & Queue Patterns — Media Ops Platform

> Đọc file này trước khi viết bất kỳ BullMQ job, cron job, hoặc background worker nào.

---

## BullMQ Cheatsheet — Add Jobs

```typescript
import { Queue } from 'bullmq'
import { redis } from '@/lib/redis'

const postPublisherQueue = new Queue('post-publisher', { connection: redis })

// Add job ngay lập tức
await postPublisherQueue.add('publish', { postId, channelId, platform })

// Add job với delay (ms)
await postPublisherQueue.add('publish', jobData, {
  delay: scheduledAt.getTime() - Date.now(), // milliseconds từ bây giờ
  jobId: `post-${postId}`, // idempotent: không add 2 lần cùng job
  attempts: 3,
  backoff: { type: 'exponential', delay: 120_000 } // 2 phút, 4 phút, 8 phút
})

// Add recurring job (cron)
await postPublisherQueue.add('check-scheduled', {}, {
  repeat: { pattern: '* * * * *' }, // mỗi phút
  jobId: 'check-scheduled-cron' // fixed ID để không tạo duplicate
})

// Cancel/remove job đã add
const job = await postPublisherQueue.getJob(`post-${postId}`)
await job?.remove()
```

---

## Cron Expressions cho Dự án

```
* * * * *       → mỗi phút (check scheduled posts)
0 * * * *       → mỗi giờ tròn (sync active channels)
0 */6 * * *     → mỗi 6 giờ (sync all channels)
0 7 * * *       → 7:00 sáng hàng ngày (daily report)
0 7 * * 1       → 7:00 sáng thứ 2 hàng tuần (weekly report)
*/15 * * * *    → mỗi 15 phút (sync monetization-building channels)
0 0 1 * *       → đầu tháng (monthly cleanup)
```

---

## Worker Pattern — NestJS

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'

@Processor('post-publisher')
export class PostPublisherWorker extends WorkerHost {
  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly metaService: MetaService,
    private readonly prisma: PrismaService,
    private readonly alertService: AlertService,
  ) { super() }

  async process(job: Job<PostPublishJob>): Promise<void> {
    const { postId, channelId, platform } = job.data
    
    // 1. Load và validate
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { channel: true }
    })
    if (!post || post.status !== 'SCHEDULED') {
      // Job không còn valid, skip mà không throw error
      return
    }

    try {
      // 2. Publish theo platform
      let platformPostId: string
      switch (platform) {
        case 'YOUTUBE':
          platformPostId = await this.youtubeService.publishVideo(post)
          break
        case 'FACEBOOK':
          platformPostId = await this.metaService.publishFBPost(post)
          break
        // ... etc
      }

      // 3. Update DB khi thành công
      await this.prisma.post.update({
        where: { id: postId },
        data: { status: 'PUBLISHED', publishedAt: new Date(), platformPostId }
      })

    } catch (error) {
      // 4. Nếu là lần retry cuối → đánh dấu FAILED + tạo Alert
      if (job.attemptsMade >= (job.opts.attempts ?? 1) - 1) {
        await this.prisma.post.update({
          where: { id: postId },
          data: { status: 'FAILED', failReason: error.message }
        })
        await this.alertService.create({
          channelId,
          type: 'SCHEDULED_POST_FAILED',
          message: `Bài "${post.title}" không được đăng: ${error.message}`,
          severity: 'HIGH'
        })
      }
      throw error // BullMQ sẽ retry
    }
  }
}
```

---

## Job Idempotency — Không chạy 2 lần

```typescript
// Dùng jobId cố định để ngăn duplicate
await queue.add('publish', data, {
  jobId: `post:${postId}:${scheduledAt.toISOString().split('T')[0]}`
})

// Check trước khi add
async function schedulePostSafely(post: Post) {
  const jobId = `post:${post.id}`
  const existing = await postPublisherQueue.getJob(jobId)
  
  if (existing) {
    // Job đã tồn tại — cập nhật nếu thời gian thay đổi
    await existing.remove()
  }
  
  await postPublisherQueue.add('publish', { postId: post.id }, {
    jobId,
    delay: post.scheduledAt.getTime() - Date.now()
  })
}
```

---

## Graceful Shutdown — NestJS

```typescript
// app.module.ts
import { BullModule } from '@nestjs/bullmq'

@Module({
  imports: [
    BullModule.forRoot({
      connection: { host: process.env.REDIS_HOST, port: 6379 },
      // Drain queues on shutdown
    }),
  ]
})

// main.ts
app.enableShutdownHooks()

// Trong worker — cleanup
@OnQueueEvent('drained')
onDrained() {
  console.log('Queue drained, safe to shutdown')
}
```

---

## Best-time Calculator

```typescript
// Dựa vào analytics history để tìm giờ đăng tốt nhất
async function getBestPublishTime(channelId: string, platform: Platform): Promise<Date> {
  // Lấy analytics 30 ngày qua, group theo giờ
  const hourlyData = await prisma.$queryRaw<{ hour: number; avgViews: number }[]>`
    SELECT 
      EXTRACT(HOUR FROM a."date" AT TIME ZONE 'Asia/Ho_Chi_Minh') as hour,
      AVG(a.views) as "avgViews"
    FROM "Analytics" a
    WHERE a."channelId" = ${channelId}
      AND a.date >= NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY "avgViews" DESC
    LIMIT 1
  `
  
  const bestHour = hourlyData[0]?.hour ?? 20 // default 8pm
  
  // Tìm ngày tiếp theo mà giờ đó chưa qua
  const now = new Date()
  const candidate = setHours(addDays(now, 1), bestHour)
  candidate.setMinutes(0)
  candidate.setSeconds(0)
  
  return candidate
}
```

---

## Redis Quota Manager (YouTube)

```typescript
// Key: youtube:quota:YYYY-MM-DD → { used: number, limit: 10000 }
const QUOTA_KEY = () => `youtube:quota:${format(new Date(), 'yyyy-MM-dd')}`

async function checkAndConsumeQuota(units: number): Promise<boolean> {
  const key = QUOTA_KEY()
  const raw = await redis.get(key)
  const current = raw ? JSON.parse(raw) : { used: 0, limit: 10000 }
  
  if (current.used + units > current.limit * 0.9) { // 90% threshold
    return false // Quota gần hết
  }
  
  await redis.setex(key, 86400, JSON.stringify({ ...current, used: current.used + units }))
  return true
}

// Units của các YouTube API calls
const YOUTUBE_QUOTA_COSTS = {
  'channels.list': 1,
  'videos.list': 1,
  'videos.insert': 1600, // Upload video rất tốn quota!
  'analytics.query': 1,
  'playlistItems.list': 1,
}
```

---

## Testing Jobs Locally

```typescript
// Trigger job manually trong development
// Tạo test script: scripts/trigger-job.ts
import { postPublisherQueue } from '@/modules/queue/queues'

async function main() {
  await postPublisherQueue.add('publish-test', {
    postId: 'test-post-id',
    channelId: 'test-channel-id',
    platform: 'FACEBOOK',
  }, {
    removeOnComplete: false, // Giữ lại để inspect
    removeOnFail: false,
  })
  console.log('Job added!')
  process.exit(0)
}

main()
// Run: npx ts-node scripts/trigger-job.ts
```
