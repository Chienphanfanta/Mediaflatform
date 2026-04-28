// Mount Bull Board UI tại /admin/queues.
// Auth: HTTP Basic — env BULL_BOARD_USER + BULL_BOARD_PASS.
// LƯU Ý: Phase 1 production nên integrate với NextAuth session để chỉ SUPERADMIN access.
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import basicAuth from 'express-basic-auth';
import type { Queue } from 'bullmq';

import { QueueService } from './services/queue.service';

const BASE_PATH = '/admin/queues';
const logger = new Logger('BullBoard');

export function setupBullBoard(app: INestApplication): void {
  const expressInstance = app.getHttpAdapter().getInstance();
  if (!expressInstance || typeof expressInstance.use !== 'function') {
    logger.warn('Express instance không tồn tại — skip Bull Board mount');
    return;
  }

  const queueService = app.get(QueueService);
  const queues: Queue[] = queueService.getQueues();

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BASE_PATH);
  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  // Basic auth gate — env-based. Production: replace bằng JWT/session middleware
  // verify SUPERADMIN.
  const user = process.env.BULL_BOARD_USER;
  const pass = process.env.BULL_BOARD_PASS;
  if (!user || !pass) {
    logger.warn(
      `BULL_BOARD_USER/PASS chưa set — skip mount tại ${BASE_PATH} (production phải set)`,
    );
    return;
  }

  expressInstance.use(
    BASE_PATH,
    basicAuth({
      users: { [user]: pass },
      challenge: true,
      realm: 'BullBoard',
    }),
    serverAdapter.getRouter(),
  );
  logger.log(`Bull Board mounted: ${BASE_PATH} (basic auth)`);
}
