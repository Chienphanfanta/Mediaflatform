// GET /api/v1/kpi — list KPIs với filter (employeeId, channelId, scope,
//   periodType, status, activeOn).
// POST /api/v1/kpi — create KPI mới (MANAGER+).
//
// Permission: STAFF+ list (auto-filter chỉ thấy KPI tenant); MANAGER+ create.
// Tenant scope auto-injected qua extension.
import { Prisma } from '@prisma/client';

import { fail, ok } from '@/lib/api-response';
import { derivePeriodEnd } from '@/lib/kpi/calculator';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { createKpiSchema, kpiListQuerySchema } from '@/lib/schemas/kpi';
import { withAuth } from '@/lib/with-auth';

export const GET = withAuth(async ({ req }) => {
  const url = new URL(req.url);
  const parsed = kpiListQuerySchema.safeParse({
    employeeId: url.searchParams.get('employeeId') ?? undefined,
    channelId: url.searchParams.get('channelId') ?? undefined,
    scope: url.searchParams.get('scope') ?? undefined,
    periodType: url.searchParams.get('periodType') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    activeOn: url.searchParams.get('activeOn') ?? undefined,
  });
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', 'Query không hợp lệ', {
      status: 422,
      details: parsed.error.issues,
    });
  }
  const f = parsed.data;

  const where: Prisma.KPIWhereInput = {};
  if (f.employeeId) where.employeeId = f.employeeId;
  if (f.channelId) where.channelId = f.channelId;
  if (f.scope) where.scope = f.scope;
  if (f.periodType) where.periodType = f.periodType;
  if (f.status) where.status = f.status;
  if (f.activeOn) {
    where.periodStart = { lte: f.activeOn };
    where.periodEnd = { gte: f.activeOn };
  }

  const items = await prisma.kPI.findMany({
    where,
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    include: {
      channel: { select: { id: true, name: true, platform: true } },
      employee: { select: { id: true, name: true, email: true, avatar: true } },
      assignedBy: { select: { id: true, name: true } },
    },
  });

  return ok({ items, total: items.length });
});

export const POST = withAuth(
  async ({ req, user }) => {
    if (!meetsRole(user, 'MANAGER')) {
      return fail('FORBIDDEN', 'Chỉ Manager+ giao KPI', { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = createKpiSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;

    // Verify channel + employee exist trong tenant (extension auto-filter)
    if (d.scope === 'PER_CHANNEL' && d.channelId) {
      const ch = await prisma.channel.findUnique({
        where: { id: d.channelId },
        select: { id: true },
      });
      if (!ch) {
        return fail('CHANNEL_NOT_FOUND', 'Kênh không tồn tại trong tenant', {
          status: 404,
        });
      }
    }
    const emp = await prisma.user.findUnique({
      where: { id: d.employeeId },
      select: { id: true },
    });
    if (!emp) {
      return fail('EMPLOYEE_NOT_FOUND', 'Nhân sự không tồn tại trong tenant', {
        status: 404,
      });
    }

    const periodEnd = derivePeriodEnd(d.periodType, d.periodStart);

    const created = await prisma.kPI.create({
      data: {
        tenantId: user.tenantId,
        scope: d.scope,
        channelId: d.scope === 'PER_CHANNEL' ? d.channelId! : null,
        employeeId: d.employeeId,
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
        // Status NOT_STARTED nếu period chưa bắt đầu, IN_PROGRESS nếu đã bắt đầu
        status:
          d.periodStart > new Date() ? 'NOT_STARTED' : 'IN_PROGRESS',
      },
    });

    return ok(created, { status: 201 });
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
