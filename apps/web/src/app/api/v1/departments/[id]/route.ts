// GET    /api/v1/departments/:id — chi tiết + members list
// PATCH  /api/v1/departments/:id — update (TENANT_ADMIN+)
// DELETE /api/v1/departments/:id — xoá (TENANT_ADMIN+); members.departmentId
//        sẽ tự null qua FK SetNull
import { fail, noContent, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { updateDepartmentSchema } from '@/lib/schemas/employees';
import { withAuth } from '@/lib/with-auth';

export const GET = withAuth<{ id: string }>(async ({ params }) => {
  const dept = await prisma.department.findUnique({
    where: { id: params.id },
    include: {
      manager: { select: { id: true, name: true, email: true, avatar: true } },
      members: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          position: true,
          status: true,
        },
        orderBy: { name: 'asc' },
      },
    },
  });
  if (!dept) {
    return fail('DEPARTMENT_NOT_FOUND', 'Phòng ban không tồn tại', { status: 404 });
  }
  return ok(dept);
});

export const PATCH = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    if (!meetsRole(user, 'GROUP_ADMIN')) {
      return fail('FORBIDDEN', 'Chỉ Tenant Admin+ update phòng ban', {
        status: 403,
      });
    }

    const body = await req.json().catch(() => null);
    const parsed = updateDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;

    if (d.managerId !== undefined && d.managerId !== null) {
      const m = await prisma.user.findUnique({
        where: { id: d.managerId },
        select: { id: true },
      });
      if (!m) {
        return fail('MANAGER_NOT_FOUND', 'Manager không tồn tại', { status: 404 });
      }
    }

    try {
      const updated = await prisma.department.update({
        where: { id: params.id },
        data: {
          ...(d.name !== undefined && { name: d.name }),
          ...(d.description !== undefined && { description: d.description }),
          ...(d.color !== undefined && { color: d.color }),
          ...(d.managerId !== undefined && { managerId: d.managerId }),
        },
        include: {
          manager: { select: { id: true, name: true, email: true } },
        },
      });
      return ok(updated);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'P2025') return fail('DEPARTMENT_NOT_FOUND', 'Phòng ban không tồn tại', { status: 404 });
      if (code === 'P2002') return fail('DUPLICATE_NAME', 'Tên phòng ban đã tồn tại', { status: 409 });
      throw e;
    }
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);

export const DELETE = withAuth<{ id: string }>(
  async ({ user, params }) => {
    if (!meetsRole(user, 'GROUP_ADMIN')) {
      return fail('FORBIDDEN', 'Chỉ Tenant Admin+ xoá phòng ban', { status: 403 });
    }

    try {
      await prisma.department.delete({ where: { id: params.id } });
      return noContent();
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') {
        return fail('DEPARTMENT_NOT_FOUND', 'Phòng ban không tồn tại', { status: 404 });
      }
      throw e;
    }
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
