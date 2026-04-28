// GET    /api/v1/kpi/:id — chi tiết
// PUT    /api/v1/kpi/:id — update target/notes (MANAGER+)
// DELETE /api/v1/kpi/:id — xoá (MANAGER+)
import type { Prisma } from '@prisma/client';

import { fail, noContent, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { updateKpiSchema } from '@/lib/schemas/kpi';
import { withAuth } from '@/lib/with-auth';

export const GET = withAuth<{ id: string }>(async ({ params }) => {
  const kpi = await prisma.kPI.findUnique({
    where: { id: params.id },
    include: {
      channel: { select: { id: true, name: true, platform: true } },
      employee: { select: { id: true, name: true, email: true, avatar: true } },
      assignedBy: { select: { id: true, name: true } },
    },
  });
  if (!kpi) return fail('KPI_NOT_FOUND', 'KPI không tồn tại', { status: 404 });
  return ok(kpi);
});

export const PUT = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    if (!meetsRole(user, 'MANAGER')) {
      return fail('FORBIDDEN', 'Chỉ Manager+ update KPI', { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = updateKpiSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;

    // Tenant extension auto-filters update
    const data: Prisma.KPIUpdateInput = {};
    if (d.targetFollowers !== undefined) data.targetFollowers = d.targetFollowers;
    if (d.targetFollowersGain !== undefined) data.targetFollowersGain = d.targetFollowersGain;
    if (d.targetViews !== undefined) data.targetViews = d.targetViews;
    if (d.targetWatchTime !== undefined) data.targetWatchTime = d.targetWatchTime;
    if (d.targetEngagement !== undefined) data.targetEngagement = d.targetEngagement;
    if (d.notes !== undefined) data.notes = d.notes;

    try {
      const updated = await prisma.kPI.update({
        where: { id: params.id },
        data,
      });
      return ok(updated);
    } catch (e) {
      // P2025 = record not found (cross-tenant or deleted)
      if ((e as { code?: string }).code === 'P2025') {
        return fail('KPI_NOT_FOUND', 'KPI không tồn tại', { status: 404 });
      }
      throw e;
    }
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);

export const DELETE = withAuth<{ id: string }>(
  async ({ user, params }) => {
    if (!meetsRole(user, 'MANAGER')) {
      return fail('FORBIDDEN', 'Chỉ Manager+ xoá KPI', { status: 403 });
    }
    try {
      await prisma.kPI.delete({ where: { id: params.id } });
      return noContent();
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') {
        return fail('KPI_NOT_FOUND', 'KPI không tồn tại', { status: 404 });
      }
      throw e;
    }
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
