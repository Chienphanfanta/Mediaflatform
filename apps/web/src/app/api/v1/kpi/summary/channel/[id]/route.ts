// GET /api/v1/kpi/summary/channel/:id — tổng hợp KPI của 1 kênh.
// Bao gồm cả PER_CHANNEL KPIs + PER_EMPLOYEE KPIs của owners của kênh này.
import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

export const GET = withAuth<{ id: string }>(async ({ req, params }) => {
  const url = new URL(req.url);
  const activeOnParam = url.searchParams.get('activeOn');
  const activeOn = activeOnParam ? new Date(activeOnParam) : new Date();

  const channel = await prisma.channel.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, platform: true, status: true },
  });
  if (!channel) {
    return fail('CHANNEL_NOT_FOUND', 'Kênh không tồn tại', { status: 404 });
  }

  const kpis = await prisma.kPI.findMany({
    where: {
      channelId: params.id,
      periodStart: { lte: activeOn },
      periodEnd: { gte: activeOn },
    },
    include: {
      employee: { select: { id: true, name: true, email: true, avatar: true } },
    },
    orderBy: { periodStart: 'desc' },
  });

  const totalKpis = kpis.length;
  const byStatus = kpis.reduce<Record<string, number>>((acc, k) => {
    acc[k.status] = (acc[k.status] ?? 0) + 1;
    return acc;
  }, {});
  const withPercent = kpis.filter((k) => k.achievementPercent != null);
  const avgAchievement =
    withPercent.length > 0
      ? Math.round(
          (withPercent.reduce((s, k) => s + (k.achievementPercent ?? 0), 0) /
            withPercent.length) *
            100,
        ) / 100
      : null;

  return ok({
    channel,
    activeOn: activeOn.toISOString().slice(0, 10),
    totals: {
      totalKpis,
      byStatus,
      avgAchievement,
    },
    kpis,
  });
});
