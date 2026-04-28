// Entry point NestJS - khởi tạo app, mount Bull Board, enable shutdown hooks, lắng nghe port.
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { setupBullBoard } from './modules/queue/bull-board.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // SIGTERM/SIGINT → trigger OnApplicationShutdown (QueueService.onModuleDestroy
  // close BullMQ connections + WorkerHost lifecycle drain).
  app.enableShutdownHooks();

  // Mount /admin/queues UI (basic auth qua BULL_BOARD_USER + BULL_BOARD_PASS env).
  setupBullBoard(app);

  const port = process.env.API_PORT ?? 4000;
  await app.listen(port);
}

bootstrap();
