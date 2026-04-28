// Scheduler cron — V2 STUB.
// V1 logic (quét scheduled posts → enqueue publish) bỏ vì V2 read-only,
// không có Post entity và không có publish workflow. File giữ shape compatible
// để DI graph không vỡ.
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SchedulerCronService {
  private readonly logger = new Logger(SchedulerCronService.name);

  constructor() {
    // V1 @Cron checkScheduledPosts removed — Sprint 6 sẽ add KPI rollup cron nếu cần.
    void this.logger;
  }
}
