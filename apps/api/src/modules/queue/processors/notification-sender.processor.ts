// notification-sender worker — gửi email + in-app notification.
// PHASE 0 STUB: log only. Phase 1 wire:
//   - 'inApp' → ghi vào bảng Notification (chưa có schema) hoặc dùng Alert
//   - 'email' → SMTP (nodemailer) hoặc Resend/SendGrid SDK
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { JOB_TIMEOUT_MS, QUEUE_NAMES, WORKER_OPTIONS } from '../queues.constants';
import { JobLogService } from '../services/job-log.service';
import type {
  NotificationChannel,
  NotificationJob,
  NotificationResult,
} from '../types/job-types';

const QUEUE = QUEUE_NAMES.NOTIFICATION_SENDER;

@Processor(QUEUE, WORKER_OPTIONS[QUEUE])
export class NotificationSenderProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationSenderProcessor.name);

  constructor(private readonly jobLog: JobLogService) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<NotificationResult> {
    await this.jobLog.logActive(QUEUE, job);

    return runWithTimeout(JOB_TIMEOUT_MS[QUEUE], async () => {
      const { userId, type, channels } = job.data;
      const delivered: NotificationChannel[] = [];
      const failed: NotificationResult['failed'] = [];

      for (const ch of channels) {
        try {
          if (ch === 'email') {
            // Phase 1: Resend/Nodemailer
            this.logger.log(`[stub] Email to ${userId}: type=${type}`);
            delivered.push('email');
          } else if (ch === 'inApp') {
            // Phase 1: ghi Notification table (cần schema)
            this.logger.log(`[stub] In-app for ${userId}: type=${type}`);
            delivered.push('inApp');
          }
        } catch (e) {
          failed.push({ channel: ch, error: (e as Error).message });
        }
      }

      return { userId, delivered, failed };
    });
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job): Promise<void> {
    await this.jobLog.logCompleted(QUEUE, job, job.returnvalue);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error): Promise<void> {
    this.logger.error(`Notif to ${job.data.userId} failed: ${err.message}`);
    await this.jobLog.logFailed(QUEUE, job, err);
  }
}

function runWithTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Job timeout sau ${ms}ms`)), ms),
    ),
  ]);
}
