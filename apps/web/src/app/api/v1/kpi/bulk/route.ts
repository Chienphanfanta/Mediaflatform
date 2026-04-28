// POST /api/v1/kpi/bulk — giao cùng KPI cho nhiều nhân viên (MANAGER+).
// Body: { employeeIds: string[], scope, channelId?, periodType, periodStart,
//   targets... }
// Tạo N KPIs trong 1 transaction.
import { fail, ok } from '@/lib/api-response';
import { derivePeriodEnd } from '@/lib/kpi/calculator';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { bulkAssignKpiSchema } from '@/lib/schemas/kpi';
import { withAuth } from '@/lib/with-auth';

export const POST = withAuth(
  async ({ req, user }) => {
    if (!meetsRole(user, 'MANAGER')) {
      return fail('FORBIDDEN', 'Chỉ Manager+ bulk-assign KPI', { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = bulkAssignKpiSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;

    // Verify channel + employees tồn tại trong tenant
    if (d.scope === 'PER_CHANNEL' && d.channelId) {
      const ch = await prisma.channel.findUnique({
        where: { id: d.channelId },
        select: { id: true },
      });
      if (!ch) {
        return fail('CHANNEL_NOT_FOUND', 'Kênh không tồn tại', { status: 404 });
      }
    }
    const employees = await prisma.user.findMany({
      where: { id: { in: d.employeeIds }, deletedAt: null },
      select: { id: true },
    });
    if (employees.length !== d.employeeIds.length) {
      const found = new Set(employees.map((e) => e.id));
      const missing = d.employeeIds.filter((id) => !found.has(id));
      return fail('SOME_EMPLOYEES_NOT_FOUND', 'Một số nhân sự không tồn tại', {
        status: 404,
        details: { missingIds: missing },
      });
    }

    const periodEnd = derivePeriodEnd(d.periodType, d.periodStart);
    const initialStatus = d.periodStart > new Date() ? 'NOT_STARTED' : 'IN_PROGRESS';

    const created = await prisma.$transaction(
      d.employeeIds.map((employeeId) =>
        prisma.kPI.create({
          data: {
            tenantId: user.tenantId,
            scope: d.scope,
            channelId: d.scope === 'PER_CHANNEL' ? d.channelId! : null,
            employeeId,
            periodType: d.periodType,
            periodStart: d.periodStart,
            periodEnd,
            targetFollowers: d.targetFollowers ?? null,
            targetFollowersGain: d.targetFollowersGain ?? null,
            targetViews: d.targetViews ?? null,
            targetWatchTime: d.targetWatchTime ?? null,
            targetEngagement: d.targetEngagement ?? null,
            notes: d.notes ?? null,
            assignedById: user.id,
            status: initialStatus,
          },
          select: { id: true, employeeId: true, status: true },
        }),
      ),
    );

    return ok(
      { count: created.length, items: created },
      { status: 201 },
    );
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);
