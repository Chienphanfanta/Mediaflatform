// Wrapper ioredis cho NestJS DI. Graceful fallback nếu REDIS_URL không set / mất kết nối.
// Cung cấp helper rate-limit (SET NX EX) — pattern dùng cho YouTube sync, etc.
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private readonly logger = new Logger(RedisService.name);

  onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL chưa set — cache/rate-limit sẽ no-op');
      return;
    }
    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        lazyConnect: false,
      });
      this.client.on('error', (err) => {
        if ((this.client as unknown as { __errLogged?: boolean }).__errLogged) return;
        (this.client as unknown as { __errLogged?: boolean }).__errLogged = true;
        this.logger.warn(`Redis error (sẽ bypass): ${err.message}`);
      });
      this.client.on('connect', () => {
        (this.client as unknown as { __errLogged?: boolean }).__errLogged = false;
      });
    } catch (e) {
      this.logger.error(`Redis init failed: ${(e as Error).message}`);
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Atomic rate-limit check qua SET NX EX.
   * Trả `{ allowed: false, ttl }` nếu key đã tồn tại trong window.
   * Fail open: Redis lỗi → allow (đừng block traffic vì cache down).
   */
  async checkRateLimit(
    key: string,
    ttlSec: number,
  ): Promise<{ allowed: boolean; ttl: number }> {
    if (!this.client) return { allowed: true, ttl: 0 };
    try {
      const set = await this.client.set(key, '1', 'EX', ttlSec, 'NX');
      if (set === 'OK') return { allowed: true, ttl: ttlSec };
      const ttl = await this.client.ttl(key);
      return { allowed: false, ttl: ttl > 0 ? ttl : ttlSec };
    } catch (e) {
      this.logger.warn(`checkRateLimit lỗi: ${(e as Error).message}`);
      return { allowed: true, ttl: 0 };
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (!this.client) return;
    try {
      if (ttlSec) await this.client.set(key, value, 'EX', ttlSec);
      else await this.client.set(key, value);
    } catch {
      /* ignore */
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch {
      /* ignore */
    }
  }
}
