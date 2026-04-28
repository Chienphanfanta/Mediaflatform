// POST /api/v1/kpi/:id/recalculate — manual trigger recalc (MANAGER+).
// Returns full result với actuals + per-target breakdown + new status.
import { fail, ok } from '@/lib/api-response';
import { recalculateAchievement } from '@/lib/kpi/calculator';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';

export const POST = withAuth<{ id: string }>(
  async ({ user, params }) => {
    if (!meetsRole(user, 'MANAGER')) {
      return fail('FORBIDDEN', 'Chỉ Manager+ recalc KPI', { status: 403 });
    }

    // Verify KPI exists trong tenant (extension filter)
    const kpi = await prisma.kPI.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!kpi) return fail('KPI_NOT_FOUND', 'KPI không tồn tại', { status: 404 });

    try {
      const result = await recalculateAchievement(params.id);
      return ok({
        kpiId: params.id,
        actuals: result.actuals,
        perTargetPercent: result.perTargetPercent,
        averagePercent: result.averagePercent,
        status: result.newStatus,
      });
    } catch (e) {
      return fail(
        'RECALC_FAILED',
        (e as Error).message ?? 'Recalc thất bại',
        { status: 500 },
      );
    }
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
