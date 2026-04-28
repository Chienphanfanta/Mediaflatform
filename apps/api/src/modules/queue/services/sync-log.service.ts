// SyncLog persistence — write-only audit trail per analytics-sync attempt.
// Đọc từ /api/v1/channels/:id/sync-history hoặc dashboard "kênh fail nhiều".
import { Injectable, Logger } from '@nestjs/common';
import { Platform, Prisma, SyncStatus } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

const ERROR_MAX_LEN = 1000;

export type LogSyncInput = {
  channelId: string;
  platform: Platform;
  date?: Date | null;
  status: SyncStatus;
  recordsUpdated: number;
  durationMs: number;
  jobId?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class SyncLogService {
  private readonly logger = new Logger(SyncLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: LogSyncInput): Promise<void> {
    try {
      await this.prisma.syncLog.create({
        data: {
          channelId: input.channelId,
          platform: input.platform,
          date: input.date ?? null,
          status: input.status,
          recordsUpdated: input.recordsUpdated,
          durationMs: input.durationMs,
          jobId: input.jobId ?? null,
          errorMessage: input.errorMessage?.slice(0, ERROR_MAX_LEN) ?? null,
          metadata: input.metadata
            ? (input.metadata as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
    } catch (e) {
      // Audit log fail — không throw để tránh phá worker chính
      this.logger.warn(`SyncLog create failed: ${(e as Error).message}`);
    }
  }

  /** Đếm fail trong N giờ gần nhất cho 1 channel — phục vụ alert "channel fail liên tục". */
  async countRecentFailures(
    channelId: string,
    sinceHours = 24,
  ): Promise<number> {
    const since = new Date(Date.now() - sinceHours * 3600 * 1000);
    return this.prisma.syncLog.count({
      where: {
        channelId,
        status: SyncStatus.FAILED,
        createdAt: { gte: since },
      },
    });
  }
}
