// Abstract base cho mọi PlatformService — cung cấp retry với exponential backoff
// và helper load channel + decrypt token. Subclass override withTokenRefresh nếu
// platform có refresh flow (vd Twitter), hoặc dùng decrypt thẳng (Telegram, WhatsApp).
import {
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Channel, Platform } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { decryptToken } from '../../lib/token-encryption';

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Default: retry khi status === 429 hoặc >= 500, hoặc network error. */
  isRetryable?: (e: unknown) => boolean;
};

export const CHANNEL_SELECT = {
  id: true,
  platform: true,
  accountId: true,
  accessToken: true,
  refreshToken: true,
  tokenExpiresAt: true,
  metadata: true,
  status: true,
} as const;

export type LoadedChannel = Pick<Channel, keyof typeof CHANNEL_SELECT>;

export abstract class BasePlatformService {
  protected abstract readonly platform: Platform;
  protected readonly logger: Logger;

  constructor(protected readonly prisma: PrismaService) {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Retry với exponential backoff + jitter.
   * Default 3 attempts × base 1s → ~1s, ~2s, ~4s (+jitter ≤500ms).
   */
  protected async retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {},
  ): Promise<T> {
    const {
      attempts = 3,
      baseDelayMs = 1000,
      maxDelayMs = 30_000,
      isRetryable = defaultRetryable,
    } = options;

    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        if (i === attempts - 1 || !isRetryable(e)) {
          this.logger.error(
            `Retry exhausted (${i + 1}/${attempts}) hoặc non-retryable: ${(e as Error).message}`,
          );
          throw e;
        }
        // Honour explicit retry-after nếu error có (vd Telegram, Meta)
        const explicit = extractRetryAfterMs(e);
        const baseBackoff = baseDelayMs * Math.pow(2, i);
        const jitter = Math.random() * 500;
        const delay = Math.min(maxDelayMs, explicit ?? baseBackoff + jitter);

        this.logger.warn(
          `Retry ${i + 1}/${attempts} sau ${Math.round(delay)}ms: ${(e as Error).message}`,
        );
        await sleep(delay);
      }
    }
    throw lastError;
  }

  protected async loadChannel(
    channelId: string,
    requirePlatform = true,
  ): Promise<LoadedChannel> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_SELECT,
    });
    if (!channel) {
      throw new NotFoundException(`Channel ${channelId} không tồn tại`);
    }
    if (requirePlatform && channel.platform !== this.platform) {
      throw new BadRequestException(
        `Channel ${channelId} platform=${channel.platform}, cần ${this.platform}`,
      );
    }
    if (!channel.accessToken) {
      throw new BadRequestException(
        `Channel ${channelId} chưa có access token (chưa connect?)`,
      );
    }
    return channel;
  }

  /** Decrypt token thẳng (không refresh). Subclass nào cần refresh thì override. */
  protected getDecryptedAccessToken(channel: LoadedChannel): string {
    if (!channel.accessToken) {
      throw new BadRequestException('Channel không có access token');
    }
    return decryptToken(channel.accessToken);
  }
}

// ────────── Module-private helpers ──────────

function defaultRetryable(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const obj = e as { status?: number; code?: string | number };
  if (typeof obj.status === 'number') {
    return obj.status === 429 || obj.status >= 500;
  }
  // Node fetch network errors
  if (typeof obj.code === 'string') {
    return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(obj.code);
  }
  return false;
}

function extractRetryAfterMs(e: unknown): number | null {
  if (typeof e !== 'object' || e === null) return null;
  const obj = e as { retryAfterSec?: number; retryAfter?: number };
  if (typeof obj.retryAfterSec === 'number') return obj.retryAfterSec * 1000;
  if (typeof obj.retryAfter === 'number') return obj.retryAfter * 1000;
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
