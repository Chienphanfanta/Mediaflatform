// Queue inspector — read-only BullMQ access từ Next.js API routes.
// SERVER-ONLY: import vào /api/v1/admin/queues/* handlers.
//
// Nguyên tắc: web KHÔNG xử lý jobs (apps/api owns workers + producers); chỉ
// đọc state real-time + cho phép retry/remove. Singleton Queue instance per
// queueName để khỏi mở 4 connection mới mỗi request.
//
// JobLog table (Prisma) là source-of-truth cho timeline 24h vì BullMQ key có
// TTL — không thể truy lại lịch sử cũ chỉ từ Redis.
import { Queue, type Job } from 'bullmq';

import { prisma } from '@/lib/prisma';

export const QUEUE_NAMES = [
  'post-publisher',
  'analytics-sync',
  'alert-checker',
  'notification-sender',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export type JobStatus = 'active' | 'waiting' | 'completed' | 'failed' | 'delayed' | 'paused';

const cache = new Map<QueueName, Queue>();

function getQueue(name: QueueName): Queue | null {
  if (cache.has(name)) return cache.get(name)!;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const q = new Queue(name, {
    connection: { url, maxRetriesPerRequest: null },
  });
  // Suppress error logs khi Redis down — fallback graceful
  q.on('error', () => {
    /* swallowed; getJobCounts() sẽ throw nếu thực sự cần */
  });
  cache.set(name, q);
  return q;
}

// ────────── Stats ──────────

export type QueueStats = {
  name: QueueName;
  counts: Record<'active' | 'waiting' | 'completed' | 'failed' | 'delayed' | 'paused', number>;
  recentCompleted24h: number;
  recentFailed24h: number;
  paused: boolean;
};

export async function getAllQueueStats(): Promise<QueueStats[]> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  // JobLog 24h aggregate — gom 1 query
  const logRows = await prisma.jobLog.groupBy({
    by: ['queueName', 'status'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const logsByQueue = new Map<string, Record<string, number>>();
  for (const r of logRows) {
    if (!logsByQueue.has(r.queueName)) logsByQueue.set(r.queueName, {});
    logsByQueue.get(r.queueName)![r.status] = r._count._all;
  }

  const out: QueueStats[] = [];
  for (const name of QUEUE_NAMES) {
    const q = getQueue(name);
    let counts = {
      active: 0,
      waiting: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    };
    let isPaused = false;
    if (q) {
      try {
        const c = await q.getJobCounts(
          'active',
          'waiting',
          'completed',
          'failed',
          'delayed',
          'paused',
        );
        counts = {
          active: c.active ?? 0,
          waiting: c.waiting ?? 0,
          completed: c.completed ?? 0,
          failed: c.failed ?? 0,
          delayed: c.delayed ?? 0,
          paused: c.paused ?? 0,
        };
        isPaused = await q.isPaused();
      } catch {
        // Redis down → counts giữ 0, UI hiển thị stale state
      }
    }
    const dbCounts = logsByQueue.get(name) ?? {};
    out.push({
      name,
      counts,
      recentCompleted24h: dbCounts.COMPLETED ?? 0,
      recentFailed24h: dbCounts.FAILED ?? 0,
      paused: isPaused,
    });
  }
  return out;
}

// ────────── Job listing ──────────

export type JobSummary = {
  id: string;
  name: string;
  status: JobStatus;
  data: unknown;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: string;
  processedOn: number | null;
  finishedOn: number | null;
  durationMs: number | null;
  failedReason: string | null;
};

export async function listJobs(
  queueName: QueueName,
  status: JobStatus,
  page = 1,
  pageSize = 20,
): Promise<{ items: JobSummary[]; total: number }> {
  const q = getQueue(queueName);
  if (!q) return { items: [], total: 0 };

  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;
  const [jobs, counts] = await Promise.all([
    q.getJobs([status], start, end, /* asc */ status === 'waiting' || status === 'delayed'),
    q.getJobCounts(status),
  ]);
  const total = counts[status] ?? 0;

  const items: JobSummary[] = jobs.map((j) => summarize(j, status));
  return { items, total };
}

export async function getJobDetail(
  queueName: QueueName,
  jobId: string,
): Promise<(JobSummary & { stacktrace: string[]; returnvalue: unknown }) | null> {
  const q = getQueue(queueName);
  if (!q) return null;
  const job = await q.getJob(jobId);
  if (!job) return null;
  const state = (await job.getState()) as JobStatus;
  const summary = summarize(job, state);
  return {
    ...summary,
    stacktrace: job.stacktrace ?? [],
    returnvalue: job.returnvalue,
  };
}

export async function retryJob(
  queueName: QueueName,
  jobId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const q = getQueue(queueName);
  if (!q) return { ok: false, reason: 'redis-unavailable' };
  const job = await q.getJob(jobId);
  if (!job) return { ok: false, reason: 'job-not-found' };
  const state = await job.getState();
  if (state !== 'failed') {
    return { ok: false, reason: `job-not-failed (state=${state})` };
  }
  await job.retry();
  return { ok: true };
}

export async function removeJob(
  queueName: QueueName,
  jobId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const q = getQueue(queueName);
  if (!q) return { ok: false, reason: 'redis-unavailable' };
  const job = await q.getJob(jobId);
  if (!job) return { ok: false, reason: 'job-not-found' };
  await job.remove();
  return { ok: true };
}

// ────────── Hourly timeline (last 24h từ JobLog) ──────────

export type TimelineBucket = {
  hour: string; // ISO truncated to hour
  completed: number;
  failed: number;
};

export async function getTimeline24h(): Promise<TimelineBucket[]> {
  const now = new Date();
  // Round down current hour
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);
  const since = new Date(currentHour.getTime() - 23 * 3600 * 1000);

  const rows = await prisma.jobLog.findMany({
    where: { createdAt: { gte: since }, status: { in: ['COMPLETED', 'FAILED'] } },
    select: { createdAt: true, status: true },
  });

  const buckets = new Map<string, TimelineBucket>();
  for (let i = 0; i < 24; i++) {
    const d = new Date(since.getTime() + i * 3600 * 1000);
    const key = d.toISOString();
    buckets.set(key, { hour: key, completed: 0, failed: 0 });
  }
  for (const r of rows) {
    const d = new Date(r.createdAt);
    d.setMinutes(0, 0, 0);
    const key = d.toISOString();
    const b = buckets.get(key);
    if (!b) continue;
    if (r.status === 'COMPLETED') b.completed++;
    else if (r.status === 'FAILED') b.failed++;
  }
  return [...buckets.values()];
}

// ────────── Helpers ──────────

function summarize(job: Job, state: JobStatus): JobSummary {
  const processedOn = job.processedOn ?? null;
  const finishedOn = job.finishedOn ?? null;
  const durationMs =
    processedOn && finishedOn ? finishedOn - processedOn : null;
  return {
    id: String(job.id),
    name: job.name,
    status: state,
    data: truncate(job.data),
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? 3,
    createdAt: new Date(job.timestamp).toISOString(),
    processedOn,
    finishedOn,
    durationMs,
    failedReason: job.failedReason ?? null,
  };
}

function truncate(data: unknown): unknown {
  // Cap data preview ~2KB để tránh response phình
  try {
    const s = JSON.stringify(data);
    if (s.length <= 2048) return data;
    return { __truncated: true, preview: s.slice(0, 2000) + '...' };
  } catch {
    return { __truncated: true };
  }
}
