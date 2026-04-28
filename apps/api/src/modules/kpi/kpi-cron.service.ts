// KPI cron — daily 7am recalc cho tất cả KPIs IN_PROGRESS / NOT_STARTED của
// mọi tenant ACTIVE.
//
// Cũng update KPIs vừa start (NOT_STARTED → IN_PROGRESS) hoặc vừa end
// (IN_PROGRESS → MISSED nếu chưa đạt) tự động qua deriveStatus.
//
// Cron-locked (single-instance) — multiple pod chạy cron sẽ duplicate work.
// Phase 9 sẽ chuyển sang BullMQ repeatable + Redis lock (KNOWN ISSUE #18).
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { KpiCalculatorService } from './kpi-calculator.service';

@Injectable()
export class KpiCronService {
  private readonly logger = new Logger(KpiCronService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly calc: KpiCalculatorService,
  ) {}

  /**
   * Daily 7:00 (Asia/Ho_Chi_Minh = UTC 00:00). Recalculate tất cả KPIs đang
   * active (NOT_STARTED hoặc IN_PROGRESS) cross-tenant.
   *
   * Cũng "ratchet up" KPIs vừa expire (periodEnd <= now) — sẽ chuyển sang
   * MISSED/ACHIEVED/EXCEEDED tuỳ achievement.
   */
  @Cron('0 0 * * *', {
    name: 'kpi.daily-recalc',
    timeZone: 'UTC', // = 07:00 Asia/Ho_Chi_Minh
  })
  async dailyKPIRecalculation(): Promise<void> {
    if (this.running) {
      this.logger.debug('dailyKPIRecalculation đang chạy — skip tick');
      return;
    }
    this.running = true;
    const t0 = Date.now();
    let recalced = 0;
    let errors = 0;

    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, slug: true },
      });

      this.logger.log(`[kpi-recalc] Loop ${tenants.length} ACTIVE tenants`);

      for (const tenant of tenants) {
        const kpis = await this.prisma.kPI.findMany({
          where: {
            tenantId: tenant.id,
            // Recalc cả NOT_STARTED (status sẽ flip → IN_PROGRESS nếu period đã start)
            // + IN_PROGRESS + ACHIEVED/EXCEEDED chưa expire (có thể bump up nếu progress)
            status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED', 'EXCEEDED'] },
          },
          select: { id: true },
        });

        for (const kpi of kpis) {
          try {
            await this.calc.recalculateAchievement(kpi.id);
            recalced++;
          } catch (e) {
            errors++;
            this.logger.error(
              `Recalc KPI ${kpi.id} (tenant ${tenant.slug}) failed: ${(e as Error).message}`,
            );
          }
        }
      }

      this.logger.log(
        `[kpi-recalc] Done in ${Date.now() - t0}ms — recalced ${recalced} KPIs, errors=${errors}`,
      );
    } finally {
      this.running = false;
    }
  }
}
