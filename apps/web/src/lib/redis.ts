// Redis client singleton với graceful fallback.
// Nếu REDIS_URL không set hoặc connect fail → service tự bypass cache, không throw.
// SERVER-ONLY — đừng import từ client components.
import Redis from 'ioredis';

let _redis: Redis | null | undefined = undefined; // undefined = chưa init, null = không có Redis

export function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.info('[redis] REDIS_URL chưa set → cache bypass');
    _redis = null;
    return null;
  }

  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false, // fail fast thay vì queue vô hạn
      lazyConnect: false,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    });
    client.on('error', (err) => {
      // Log 1 lần khi mất kết nối — không spam
      if ((client as any).__errored) return;
      (client as any).__errored = true;
      console.warn('[redis] connection error, sẽ bypass cache:', err.message);
    });
    client.on('connect', () => {
      (client as any).__errored = false;
    });
    _redis = client;
    return client;
  } catch (e) {
    console.error('[redis] init failed:', (e as Error).message);
    _redis = null;
    return null;
  }
}

/**
 * Generic cache wrapper — tự handle JSON serialize, TTL, graceful fallback.
 * Loader chạy khi miss hoặc Redis down.
 */
export async function cached<T>(
  key: string,
  ttlSec: number,
  loader: () => Promise<T>,
): Promise<T> {
  const r = getRedis();
  if (r) {
    try {
      const val = await r.get(key);
      if (val) return JSON.parse(val) as T;
    } catch (e) {
      console.warn('[cache] GET lỗi, bypass:', (e as Error).message);
    }
  }

  const data = await loader();

  if (r) {
    // Fire-and-forget — không chặn response nếu Redis chậm
    r.set(key, JSON.stringify(data), 'EX', ttlSec).catch((e) => {
      console.warn('[cache] SET lỗi:', e.message);
    });
  }
  return data;
}

/** Invalidate key(s) — dùng khi write operation cần clear cache. */
export async function invalidate(...keys: string[]): Promise<void> {
  const r = getRedis();
  if (!r || keys.length === 0) return;
  try {
    await r.del(...keys);
  } catch (e) {
    console.warn('[cache] DEL lỗi:', (e as Error).message);
  }
}

/** Invalidate theo prefix pattern (SCAN + DEL). Dùng cho invalidate group. */
export async function invalidatePattern(pattern: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  let count = 0;
  try {
    const stream = r.scanStream({ match: pattern, count: 100 });
    const pipeline = r.pipeline();
    for await (const keys of stream) {
      for (const k of keys as string[]) {
        pipeline.del(k);
        count++;
      }
    }
    if (count > 0) await pipeline.exec();
  } catch (e) {
    console.warn('[cache] SCAN lỗi:', (e as Error).message);
  }
  return count;
}
