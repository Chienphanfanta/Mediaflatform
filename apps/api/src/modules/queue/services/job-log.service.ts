// Persist job lifecycle vào bảng JobLog. Audit trail bền hơn BullMQ Redis state.
// Truncate stack trace + payload large để giữ DB nhẹ.
import { Injectable, Logger } from '@nestjs/common';
import { JobLogStatus, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';

import { PrismaService } from '../../../prisma/prisma.service';

const MAX_DATA_BYTES = 10 * 1024;
const MAX_ERROR_CHARS = 4000;

function safeJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const str = JSON.stringify(value);
    if (str.length > MAX_DATA_BYTES) {
      return { _truncated: true, preview: str.slice(0, MAX_DATA_BYTES) };
    }
    return value as Prisma.InputJsonValue;
  } catch {
    return { _serializeError: true };
  }
}

@Injectable()
export class JobLogService {
  private readonly logger = new Logger(JobLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logActive(queueName: string, job: Job): Promise<void> {
    try {
      await this.prisma.jobLog.create({
        data: {
          queueName,
          jobId: String(job.id),
          jobName: job.name,
          status: JobLogStatus.ACTIVE,
          attemptsMade: job.attemptsMade,
          data: safeJson(job.data),
          startedAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`logActive fail: ${(e as Error).message}`);
    }
  }

  async logCompleted(queueName: string, job: Job, result: unknown): Promise<void> {
    try {
      await this.prisma.jobLog.updateMany({
        where: { queueName, jobId: String(job.id), status: JobLogStatus.ACTIVE },
        data: {
          status: JobLogStatus.COMPLETED,
          attemptsMade: job.attemptsMade,
          result: safeJson(result),
          completedAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`logCompleted fail: ${(e as Error).message}`);
    }
  }

  async logFailed(queueName: string, job: Job, error: Error): Promise<void> {
    try {
      const errorText = (error.stack ?? error.message).slice(0, MAX_ERROR_CHARS);
      // Nếu chưa có row ACTIVE (vd job fail trước khi enter process) → tạo mới
      const existing = await this.prisma.jobLog.findFirst({
        where: { queueName, jobId: String(job.id), status: JobLogStatus.ACTIVE },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.jobLog.update({
          where: { id: existing.id },
          data: {
            status: JobLogStatus.FAILED,
            attemptsMade: job.attemptsMade,
            error: errorText,
            completedAt: new Date(),
          },
        });
      } else {
        await this.prisma.jobLog.create({
          data: {
            queueName,
            jobId: String(job.id),
            jobName: job.name,
            status: JobLogStatus.FAILED,
            attemptsMade: job.attemptsMade,
            data: safeJson(job.data),
            error: errorText,
            completedAt: new Date(),
          },
        });
      }
    } catch (e) {
      this.logger.warn(`logFailed fail: ${(e as Error).message}`);
    }
  }

  async logStalled(queueName: string, jobId: string): Promise<void> {
    try {
      await this.prisma.jobLog.updateMany({
        where: { queueName, jobId, status: JobLogStatus.ACTIVE },
        data: { status: JobLogStatus.STALLED, completedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`logStalled fail: ${(e as Error).message}`);
    }
  }

  /** Đếm jobs FAILED trong queue trong N giờ qua. Dùng cho QueueMonitor. */
  async countFailedSince(queueName: string, sinceHours: number): Promise<number> {
    const since = new Date(Date.now() - sinceHours * 3600_000);
    return this.prisma.jobLog.count({
      where: {
        queueName,
        status: JobLogStatus.FAILED,
        createdAt: { gte: since },
      },
    });
  }
}
