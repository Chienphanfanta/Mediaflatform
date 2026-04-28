// GET /api/v1/kpi/summary/employee/:id — tổng hợp KPI của 1 nhân viên.
// Optional ?activeOn=YYYY-MM-DD → chỉ KPIs có period chứa date này.
// Default: KPIs đang IN_PROGRESS hoặc period chứa hôm nay.
import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

export const GET = withAuth<{ id: string }>(async ({ req, params }) => {
  const url = new URL(req.url);
  const activeOnParam = url.searchParams.get('activeOn');
  const activeOn = activeOnParam ? new Date(activeOnParam) : new Date();

  const employee = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, email: true, avatar: true },
  });
  if (!employee) {
    return fail('EMPLOYEE_NOT_FOUND', 'Nhân sự không tồn tại', { status: 404 });
  }

  const kpis = await prisma.kPI.findMany({
    where: {
      employeeId: params.id,
      periodStart: { lte: activeOn },
      periodEnd: { gte: activeOn },
    },
    include: {
      channel: { select: { id: true, name: true, platform: true } },
    },
    orderBy: { periodStart: 'desc' },
  });

  // Aggregate stats
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
    employee,
    activeOn: activeOn.toISOString().slice(0, 10),
    totals: {
      totalKpis,
      byStatus,
      avgAchievement,
    },
    kpis,
  });
});
