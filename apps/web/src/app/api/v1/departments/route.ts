// GET  /api/v1/departments — list departments với member count + manager
// POST /api/v1/departments — tạo dept (TENANT_ADMIN+)
import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { createDepartmentSchema } from '@/lib/schemas/employees';
import { withAuth } from '@/lib/with-auth';

export const GET = withAuth(async () => {
  const items = await prisma.department.findMany({
    orderBy: { name: 'asc' },
    include: {
      manager: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      _count: { select: { members: true } },
    },
  });

  return ok({ items, total: items.length });
});

export const POST = withAuth(
  async ({ req, user }) => {
    if (!meetsRole(user, 'GROUP_ADMIN')) {
      return fail('FORBIDDEN', 'Chỉ Tenant Admin+ tạo phòng ban', { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = createDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;

    // Verify manager (nếu có) thuộc tenant — extension auto-filter
    if (d.managerId) {
      const m = await prisma.user.findUnique({
        where: { id: d.managerId },
        select: { id: true },
      });
      if (!m) {
        return fail('MANAGER_NOT_FOUND', 'Manager không tồn tại', { status: 404 });
      }
    }

    try {
      const created = await prisma.department.create({
        data: {
          tenantId: user.tenantId,
          name: d.name,
          description: d.description ?? null,
          color: d.color ?? null,
          managerId: d.managerId ?? null,
        },
        include: {
          manager: { select: { id: true, name: true, email: true } },
        },
      });
      return ok(created, { status: 201 });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        return fail('DUPLICATE_NAME', 'Tên phòng ban đã tồn tại', { status: 409 });
      }
      throw e;
    }
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
