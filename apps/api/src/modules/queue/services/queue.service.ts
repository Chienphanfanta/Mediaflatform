// QueueService — facade enqueue jobs cho 3 queues (V2 stripped POST_PUBLISHER).
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type JobsOptions, Queue } from 'bullmq';

import { QUEUE_NAMES } from '../queues.constants';
import type {
  AlertCheckJob,
  AnalyticsSyncJob,
  NotificationJob,
} from '../types/job-types';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ANALYTICS_SYNC)
    private readonly analyticsSyncQueue: Queue<AnalyticsSyncJob>,
    @InjectQueue(QUEUE_NAMES.ALERT_CHECKER)
    private readonly alertCheckerQueue: Queue<AlertCheckJob>,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_SENDER)
    private readonly notificationQueue: Queue<NotificationJob>,
  ) {}

  async enqueueAnalyticsSync(
    data: AnalyticsSyncJob,
    options?: JobsOptions,
  ): Promise<string> {
    const job = await this.analyticsSyncQueue.add('sync', data, options);
    return String(job.id);
  }

  async enqueueAlertCheck(
    data: AlertCheckJob,
    options?: JobsOptions,
  ): Promise<string> {
    const job = await this.alertCheckerQueue.add('check', data, options);
    return String(job.id);
  }

  async enqueueNotification(
    data: NotificationJob,
    options?: JobsOptions,
  ): Promise<string> {
    const job = await this.notificationQueue.add('send', data, options);
    return String(job.id);
  }

  /**
   * Schedule analytics sync hàng ngày 02:00 UTC (= 09:00 VN) cho 1 channel.
   * Idempotent — dùng repeatJobKey để Bull không tạo trùng.
   */
  async scheduleDailyAnalyticsSync(channelId: string, platform: AnalyticsSyncJob['platform']): Promise<void> {
    await this.analyticsSyncQueue.add(
      'sync',
      { channelId, platform, date: null, syncType: 'daily' },
      {
        repeat: { pattern: '0 2 * * *' },
        jobId: `daily-sync:${channelId}`,
      },
    );
  }

  getQueues(): Queue[] {
    return [
      this.analyticsSyncQueue,
      this.alertCheckerQueue,
      this.notificationQueue,
    ];
  }

  async getQueueCounts(): Promise<Record<string, Record<string, number>>> {
    const queues = this.getQueues();
    const out: Record<string, Record<string, number>> = {};
    for (const q of queues) {
      try {
        const counts = await q.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'paused',
        );
        out[q.name] = counts as Record<string, number>;
      } catch (e) {
        out[q.name] = { error: -1 };
        this.logger.warn(`getJobCounts ${q.name}: ${(e as Error).message}`);
      }
    }
    return out;
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing queue connections...');
    for (const q of this.getQueues()) {
      try {
        await q.close();
      } catch (e) {
        this.logger.warn(`Close ${q.name}: ${(e as Error).message}`);
      }
    }
  }
}
