// Root module - gom tất cả feature modules + global infrastructure.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './lib/redis.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { KpiModule } from './modules/kpi/kpi.module';
import { PlatformsModule } from './modules/platforms/platforms.module';
import { QueueModule } from './modules/queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    AlertsModule,
    KpiModule,
    PlatformsModule,
    QueueModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
