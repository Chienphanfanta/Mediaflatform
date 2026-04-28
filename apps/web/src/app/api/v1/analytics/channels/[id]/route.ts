// GET /api/v1/analytics/channels/:id?from=&to=&metrics=views,watchTime,...
// Daily data points cho các metric được chọn của 1 channel.
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { getChannelMetrics } from '@/lib/analytics-service';
import {
  channelMetricsQuerySchema,
  METRIC_KEYS,
  METRIC_TO_LABEL,
  parseMetricsFilter,
} from '@/lib/schemas/analytics';

async function userCanReadChannel(
  userGroupIds: string[],
  isSuperAdmin: boolean,
  channelId: string,
): Promise<boolean> {
  if (isSuperAdmin) {
    const exists = await prisma.channel.findFirst({
      where: { id: channelId, deletedAt: null },
      select: { id: true },
    });
    return !!exists;
  }
  const exists = await prisma.channel.findFirst({
    where: {
      id: channelId,
      deletedAt: null,
      groups: { some: { groupId: { in: userGroupIds } } },
    },
    select: { id: true },
  });
  return !!exists;
}

export const GET = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    const url = new URL(req.url);
    const parsed = channelMetricsQuerySchema.safeParse({
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      metrics: url.searchParams.get('metrics') ?? undefined,
    });
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Query không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }

    const hasAccess = await userCanReadChannel(
      user.groups.map((g) => g.id),
      user.isSuperAdmin,
      params.id,
    );
    if (!hasAccess) {
      return fail('CHANNEL_NOT_FOUND', 'Không tìm thấy kênh hoặc không có quyền', {
        status: 404,
      });
    }

    const chart = await getChannelMetrics(params.id, {
      from: parsed.data.from,
      to: parsed.data.to,
    });

    // Filter datasets theo metrics param (nếu có)
    const requestedKeys = parseMetricsFilter(parsed.data.metrics);
    const invalidKeys = requestedKeys.filter(
      (k) => !(METRIC_KEYS as readonly string[]).includes(k),
    );
    if (invalidKeys.length > 0) {
      return fail('INVALID_METRIC', `Metric không hỗ trợ: ${invalidKeys.join(', ')}`, {
        status: 422,
        details: { validMetrics: METRIC_KEYS },
      });
    }

    const wantedLabels = new Set(
      requestedKeys.map((k) => METRIC_TO_LABEL[k as keyof typeof METRIC_TO_LABEL]),
    );

    const filtered = {
      labels: chart.labels,
      datasets:
        wantedLabels.size > 0
          ? chart.datasets.filter((ds) => wantedLabels.has(ds.label))
          : chart.datasets,
    };

    return ok({
      channelId: params.id,
      from: parsed.data.from.toISOString().slice(0, 10),
      to: parsed.data.to.toISOString().slice(0, 10),
      metrics: requestedKeys.length > 0 ? requestedKeys : [...METRIC_KEYS],
      chart: filtered,
    });
  },
  { rateLimit: { limit: 120, windowMs: 60_000 } },
);
