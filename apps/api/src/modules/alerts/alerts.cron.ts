// Cron schedule cho alert detection. @nestjs/schedule chạy in-process.
// LƯU Ý: deploy multi-instance cần leader election để tránh chạy trùng;
// Phase 1 chuyển qua BullMQ repeatable job để giải quyết.
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertsService } from './alerts.service';

@Injectable()
export class AlertsCron {
  private readonly logger = new Logger(AlertsCron.name);

  constructor(private readonly alerts: AlertsService) {}

  // Mỗi giờ — detect các alert thời gian thực: views drop, scheduled fail, deadline
  @Cron(CronExpression.EVERY_HOUR, { name: 'alerts.hourly-detection' })
  async hourlyDetection() {
    try {
      await this.alerts.runDetection();
    } catch (err) {
      this.logger.error(
        `Detection cron failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
