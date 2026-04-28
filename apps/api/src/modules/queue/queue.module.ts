// QueueModule — đăng ký 4 queues + processors + monitor service.
// BullModule.forRootAsync read REDIS_URL từ ConfigModule (đã global).
import { BullModule } from '@nestjs/bullmq';
import { Module, type OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AlertsModule } from '../alerts/alerts.module';
import { PlatformsModule } from '../platforms/platforms.module';
import { ALL_QUEUE_NAMES } from './queues.constants';
import { AlertCheckerProcessor } from './processors/alert-checker.processor';
import { NotificationSenderProcessor } from './processors/notification-sender.processor';
import { AnalyticsCronService } from './services/analytics-cron.service';
import { SchedulerCronService } from './services/cron.service';
import { JobLogService } from './services/job-log.service';
import { QueueMonitorService } from './services/queue-monitor.service';
import { QueueService } from './services/queue.service';
import { SyncLogService } from './services/sync-log.service';
import { SyncPriorityService } from './services/sync-priority.service';
import { YouTubeQuotaService } from './services/youtube-quota.service';
import { AnalyticsSyncWorker } from './workers/analytics-sync.worker';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        return {
          connection: { url },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            // Auto-cleanup: giữ 1000 completed gần nhất hoặc 24h
            removeOnComplete: { age: 24 * 3600, count: 1000 },
            // Failed giữ lâu hơn cho debug — 7 ngày, max 5000
            removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
          },
        };
      },
    }),
    // Đăng ký 4 queues
    BullModule.registerQueue(...ALL_QUEUE_NAMES.map((name) => ({ name }))),
    AlertsModule,
    PlatformsModule,
  ],
  providers: [
    JobLogService,
    QueueService,
    QueueMonitorService,
    SchedulerCronService,
    AnalyticsCronService,
    SyncLogService,
    SyncPriorityService,
    YouTubeQuotaService,
    AnalyticsSyncWorker,
    AlertCheckerProcessor,
    NotificationSenderProcessor,
  ],
  exports: [
    QueueService,
    JobLogService,
    YouTubeQuotaService,
    SyncPriorityService,
  ],
})
export class QueueModule implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueModule.name);

  /**
   * Graceful shutdown — đảm bảo close kết nối queue + workers trước khi exit.
   * @nestjs/bullmq Processors tự handle qua `WorkerHost` lifecycle (close worker
   * loop). QueueService.onModuleDestroy đóng Queue clients.
   * NestJS gọi onApplicationShutdown KHI nhận SIGTERM (cần `app.enableShutdownHooks()`
   * trong main.ts).
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `Application shutdown signal=${signal} — workers + queues sẽ close gracefully`,
    );
  }
}
