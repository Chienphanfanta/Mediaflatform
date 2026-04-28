// SyncPriorityService — tính + cập nhật Channel.syncPriority dựa vào hoạt động.
//
// Rules:
//   - HIGH:   có Post.publishedAt trong 24h gần nhất → sync mỗi 1h
//   - LOW:    không có post nào trong 7 ngày → sync mỗi 24h
//   - NORMAL: còn lại → sync mỗi 6h
//
// Recompute chạy 1 lần/giờ (sau hourly cron) để priority luôn cập nhật theo
// activity. Không gọi từ worker để tránh write contention.
import { Injectable, Logger } from '@nestjs/common';
import { SyncPriority } from '@prisma/client';
import { subDays } from 'date-fns';

import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class SyncPriorityService {
  private readonly logger = new Logger(SyncPriorityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recomputeAll(): Promise<{ updated: number; perPriority: Record<SyncPriority, number> }> {
    const now = new Date();
    const oneDayAgo = subDays(now, 1);
    const sevenDaysAgo = subDays(now, 7);

    const channels = await this.prisma.channel.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, syncPriority: true },
    });

    const perPriority: Record<SyncPriority, number> = {
      HIGH: 0,
      NORMAL: 0,
      LOW: 0,
    };
    let updated = 0;

    for (const c of channels) {
      // V2: Post entity removed — cannot rank channels by recent post activity.
      // Default everything to NORMAL until a V2-native heuristic is decided.
      void oneDayAgo;
      void sevenDaysAgo;
      const next: SyncPriority = SyncPriority.NORMAL;

      perPriority[next]++;

      if (c.syncPriority !== next) {
        await this.prisma.channel.update({
          where: { id: c.id },
          data: { syncPriority: next },
        });
        updated++;
      }
    }

    this.logger.log(
      `recomputeAll: ${channels.length} channels scanned, ${updated} priority updated, dist=${JSON.stringify(perPriority)}`,
    );
    return { updated, perPriority };
  }

  /** Helper: trả về interval (ms) phù hợp với priority — dùng để skip nếu lastSyncedAt còn fresh. */
  static intervalMs(priority: SyncPriority): number {
    switch (priority) {
      case SyncPriority.HIGH:
        return 1 * 3600 * 1000;
      case SyncPriority.NORMAL:
        return 6 * 3600 * 1000;
      case SyncPriority.LOW:
        return 24 * 3600 * 1000;
    }
  }
}
