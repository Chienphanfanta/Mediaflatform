// Cron monitor — chạy mỗi 5 phút, check failed job count cho mỗi queue.
// > 100 failures trong 24h → log warn + enqueue notification cho SuperAdmin.
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../../prisma/prisma.service';
import { ALL_QUEUE_NAMES, QUEUE_NAMES } from '../queues.constants';
import { JobLogService } from './job-log.service';
import { QueueService } from './queue.service';

const FAILURE_THRESHOLD = 100;
const LOOKBACK_HOURS = 24;

@Injectable()
export class QueueMonitorService {
  private readonly logger = new Logger(QueueMonitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobLog: JobLogService,
    private readonly queue: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'queue.health-check' })
  async checkHealth() {
    try {
      // Snapshot live counts từ BullMQ (waiting/active/failed/delayed)
      const counts = await this.queue.getQueueCounts();
      this.logger.debug(`Queue counts: ${JSON.stringify(counts)}`);

      // Failed count từ JobLog (persistent, 24h window)
      for (const queueName of ALL_QUEUE_NAMES) {
        const failedCount = await this.jobLog.countFailedSince(
          queueName,
          LOOKBACK_HOURS,
        );
        if (failedCount > FAILURE_THRESHOLD) {
          await this.alertHighFailureRate(queueName, failedCount);
        }
      }
    } catch (e) {
      this.logger.error(
        `Health check fail: ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }

  private async alertHighFailureRate(
    queueName: string,
    failedCount: number,
  ): Promise<void> {
    // Idempotency: chỉ alert 1 lần / 6 giờ / queue
    const key = `queue:alert-sent:${queueName}`;
    const recent = await this.prisma.jobLog
      .findFirst({
        where: {
          queueName: 'queue-monitor', // self meta-log
          jobName: queueName,
          createdAt: { gte: new Date(Date.now() - 6 * 3600_000) },
        },
        select: { id: true },
      })
      .catch(() => null);
    if (recent) return;
    void key; // dùng làm tag debug nếu cần

    this.logger.warn(
      `🚨 Queue ${queueName} có ${failedCount} failures trong ${LOOKBACK_HOURS}h — vượt threshold ${FAILURE_THRESHOLD}`,
    );

    // Self-log meta event để dedup 6h
    await this.prisma.jobLog
      .create({
        data: {
          queueName: 'queue-monitor',
          jobId: `health-${Date.now()}`,
          jobName: queueName,
          status: 'COMPLETED',
          data: { failedCount, threshold: FAILURE_THRESHOLD },
          startedAt: new Date(),
          completedAt: new Date(),
        },
      })
      .catch(() => {});

    // Enqueue notification cho mọi SuperAdmin
    const superAdmins = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        groupMembers: { some: { group: { type: 'SYSTEM' }, role: 'ADMIN' } },
      },
      select: { id: true },
    });
    for (const admin of superAdmins) {
      await this.queue
        .enqueueNotification({
          userId: admin.id,
          type: 'queue-degraded',
          data: { queueName, failedCount, lookbackHours: LOOKBACK_HOURS },
          channels: ['inApp', 'email'],
        })
        .catch((e) =>
          this.logger.warn(
            `Enqueue notif cho ${admin.id} fail: ${(e as Error).message}`,
          ),
        );
    }
  }

  // Helper truy ngược chi tiết failures cho 1 queue (debug)
  async listRecentFailures(queueName: string, limit = 50) {
    return this.prisma.jobLog.findMany({
      where: { queueName, status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        jobId: true,
        attemptsMade: true,
        error: true,
        createdAt: true,
      },
    });
  }

  // Phát hiện queue lệch (Phase 7 — placeholder)
  static QUEUE_NAMES = QUEUE_NAMES;
}
