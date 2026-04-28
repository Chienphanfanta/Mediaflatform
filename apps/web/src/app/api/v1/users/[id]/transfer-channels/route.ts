// POST /api/v1/users/:id/transfer-channels — chuyển TẤT CẢ ownerships của user
// này sang user khác.
// Body: { toEmployeeId }
//
// Logic atomic:
//   1. Verify both users tồn tại trong tenant
//   2. Tìm tất cả ChannelOwnership của fromUser
//   3. Với mỗi ownership:
//      - Nếu toUser đã có ownership trên channel đó → giữ ownership cao hơn,
//        xoá ownership của fromUser
//      - Nếu chưa → đổi employeeId thành toUser
//   4. PRIMARY conflict: nếu fromUser là PRIMARY và toUser cũng đã PRIMARY trên
//      channel khác, cả 2 → toUser thành PRIMARY trên cả (có 2 PRIMARY?). Per
//      schema, mỗi channel có nhiều owner nhưng PRIMARY có thể không unique.
//      → safest: nếu xung đột PRIMARY, giữ toUser hiện tại + demote fromUser
//      ownership thành SECONDARY trên channel đó.
import { Prisma } from '@prisma/client';

import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { meetsRole } from '@/lib/rbac';
import { transferChannelsSchema } from '@/lib/schemas/employees';
import { withAuth } from '@/lib/with-auth';

const ROLE_RANK: Record<'PRIMARY' | 'SECONDARY', number> = {
  PRIMARY: 2,
  SECONDARY: 1,
};

export const POST = withAuth<{ id: string }>(
  async ({ req, user, params }) => {
    if (!meetsRole(user, 'GROUP_ADMIN')) {
      return fail('FORBIDDEN', 'Chỉ Tenant Admin+ transfer channels', {
        status: 403,
      });
    }

    const body = await req.json().catch(() => null);
    const parsed = transferChannelsSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Body không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { toEmployeeId } = parsed.data;

    if (params.id === toEmployeeId) {
      return fail('SAME_USER', 'Source và destination phải khác nhau', {
        status: 422,
      });
    }

    const [fromUser, toUser] = await Promise.all([
      prisma.user.findUnique({
        where: { id: params.id },
        select: { id: true, deletedAt: true },
      }),
      prisma.user.findUnique({
        where: { id: toEmployeeId },
        select: { id: true, deletedAt: true, status: true },
      }),
    ]);

    if (!fromUser || fromUser.deletedAt) {
      return fail('USER_NOT_FOUND', 'Source user không tồn tại', { status: 404 });
    }
    if (!toUser || toUser.deletedAt) {
      return fail('TO_USER_NOT_FOUND', 'Destination user không tồn tại', {
        status: 404,
      });
    }
    if (toUser.status !== 'ACTIVE') {
      return fail('TO_USER_INACTIVE', 'Destination user phải ACTIVE', {
        status: 409,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const fromOwnerships = await tx.channelOwnership.findMany({
        where: { employeeId: params.id },
      });

      let transferred = 0;
      let merged = 0;
      let demoted = 0;

      for (const ownership of fromOwnerships) {
        // Check if toUser đã có ownership trên cùng channel
        const existingTo = await tx.channelOwnership.findUnique({
          where: {
            channelId_employeeId: {
              channelId: ownership.channelId,
              employeeId: toEmployeeId,
            },
          },
        });

        if (!existingTo) {
          // Đổi employeeId trực tiếp
          await tx.channelOwnership.update({
            where: { id: ownership.id },
            data: { employeeId: toEmployeeId, assignedAt: new Date() },
          });
          transferred++;
        } else {
          // toUser đã sở hữu — giữ role cao hơn, xoá fromUser ownership
          const winnerRole =
            ROLE_RANK[ownership.role] > ROLE_RANK[existingTo.role]
              ? ownership.role
              : existingTo.role;
          if (winnerRole !== existingTo.role) {
            await tx.channelOwnership.update({
              where: { id: existingTo.id },
              data: { role: winnerRole, assignedAt: new Date() },
            });
            demoted++;
          }
          await tx.channelOwnership.delete({ where: { id: ownership.id } });
          merged++;
        }
      }

      return {
        fromUserId: params.id,
        toUserId: toEmployeeId,
        transferred,
        merged,
        demoted,
        totalProcessed: fromOwnerships.length,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return ok(result);
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);
