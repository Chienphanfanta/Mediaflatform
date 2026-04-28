// REST endpoints cho NestJS API service.
// Phase 0: Web routes (apps/web/src/app/api/v1/alerts) đang là source-of-truth dùng cho FE.
// Khi NestJS deploy thật → web routes chuyển sang proxy gọi controller này.
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AlertSeverity, AlertType } from '@prisma/client';
import { AlertsService } from './alerts.service';

type ListQuery = {
  channelIds: string; // comma-separated
  isRead?: string;
  severity?: string;
  type?: string;
  page?: string;
  pageSize?: string;
};

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  async list(@Query() q: ListQuery) {
    const channelIds = (q.channelIds ?? '').split(',').filter(Boolean);
    const severities = q.severity
      ? (q.severity.split(',').filter(Boolean) as AlertSeverity[])
      : undefined;
    const types = q.type
      ? (q.type.split(',').filter(Boolean) as AlertType[])
      : undefined;

    return this.alerts.list({
      channelIds,
      isRead: q.isRead === 'true' ? true : q.isRead === 'false' ? false : undefined,
      severities,
      types,
      page: Math.max(1, parseInt(q.page ?? '1', 10)),
      pageSize: Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10))),
    });
  }

  @Put(':id/read')
  async markRead(
    @Param('id') id: string,
    @Body() body: { allowedChannelIds: string[] },
  ) {
    return this.alerts.markRead(id, body.allowedChannelIds ?? []);
  }

  @Put('read-all')
  async readAll(@Body() body: { allowedChannelIds: string[] }) {
    return this.alerts.markAllRead(body.allowedChannelIds ?? []);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Body() body: { allowedChannelIds: string[] },
  ) {
    await this.alerts.delete(id, body.allowedChannelIds ?? []);
    return { ok: true };
  }

  // Manual trigger detection — tiện cho dev/test. Phase 1 nên gate by SUPERADMIN.
  @Post('detect')
  async detect() {
    return this.alerts.runDetection();
  }
}
