// alert-checker worker — wrap AlertsService detection methods qua queue thay vì
// chạy in-process @Cron (multi-instance safe — issue #18).
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { AlertsService } from '../../alerts/alerts.service';
import { JOB_TIMEOUT_MS, QUEUE_NAMES, WORKER_OPTIONS } from '../queues.constants';
import { JobLogService } from '../services/job-log.service';
import type { AlertCheckJob, AlertCheckResult } from '../types/job-types';

const QUEUE = QUEUE_NAMES.ALERT_CHECKER;

@Processor(QUEUE, WORKER_OPTIONS[QUEUE])
export class AlertCheckerProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertCheckerProcessor.name);

  constructor(
    private readonly alerts: AlertsService,
    private readonly jobLog: JobLogService,
  ) {
    super();
  }

  async process(job: Job<AlertCheckJob>): Promise<AlertCheckResult> {
    await this.jobLog.logActive(QUEUE, job);

    return runWithTimeout(JOB_TIMEOUT_MS[QUEUE], async () => {
      const { channelId, checkType } = job.data;
      let alertsCreated = 0;

      // Phase 0: AlertsService.runDetection chạy global (không scoped channelId).
      // Phase 1: refactor AlertsService method theo channelId scope cho dispatch granular.
      if (checkType === 'all') {
        const result = await this.alerts.runDetection();
        alertsCreated = result.created;
      } else {
        // Stub — Phase 1 add per-detector method
        this.logger.log(
          `[stub] AlertCheck ${checkType} for ${channelId} — Phase 1 sẽ wire`,
        );
      }

      return { channelId, alertsCreated };
    });
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job): Promise<void> {
    await this.jobLog.logCompleted(QUEUE, job, job.returnvalue);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error): Promise<void> {
    this.logger.error(
      `Alert check ${job.data.checkType} failed: ${err.message}`,
    );
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
