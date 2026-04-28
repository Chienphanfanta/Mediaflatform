// KpiModule — calculator service + daily cron.
import { Module } from '@nestjs/common';

import { KpiCalculatorService } from './kpi-calculator.service';
import { KpiCronService } from './kpi-cron.service';

@Module({
  providers: [KpiCalculatorService, KpiCronService],
  exports: [KpiCalculatorService],
})
export class KpiModule {}
