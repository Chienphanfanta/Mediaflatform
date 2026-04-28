import { Module } from '@nestjs/common';

import { AlertEngineService } from './alert-engine.service';
import { AlertsController } from './alerts.controller';
import { AlertsCron } from './alerts.cron';
import { AlertsService } from './alerts.service';
import { NotificationService } from './notification.service';
import { PushNotificationService } from './push-notification.service';

@Module({
  controllers: [AlertsController],
  providers: [
    AlertsService,
    AlertsCron,
    AlertEngineService,
    NotificationService,
    PushNotificationService,
  ],
  exports: [
    AlertsService,
    AlertEngineService,
    NotificationService,
    PushNotificationService,
  ],
})
export class AlertsModule {}
