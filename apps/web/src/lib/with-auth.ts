// HOF bọc route handler — check auth, rate limit, set tenant context, map error.
// Sử dụng:
//   export const GET = withAuth<{ id: string }>(async ({ user, params }) => {...});
//
// Mỗi handler được wrap tự động trong `withTenant({ tenantId: user.tenantId })`
// → mọi `prisma.X.findMany/create/...` trong handler tự filter theo tenant.
import { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import { auth } from '@/auth';
import { fail } from './api-response';
import { withTenant } from './prisma';
import { rateLimit, type RateLimitOptions } from './rate-limit';
import type { SessionUser } from './rbac';

type Ctx<P> = { req: NextRequest; params: P; user: SessionUser };
type Handler<P> = (ctx: Ctx<P>) => Promise<Response> | Response;

export function withAuth<P extends Record<string, string> = Record<string, string>>(
  handler: Handler<P>,
  opts?: { rateLimit?: RateLimitOptions },
) {
  return async (req: NextRequest, routeCtx: { params: P }): Promise<Response> => {
    try {
      const session = await auth();
      if (!session?.user) {
        return fail('UNAUTHORIZED', 'Vui lòng đăng nhập', { status: 401 });
      }

      const sessionUser = session.user as SessionUser;
      if (!sessionUser.tenantId) {
        return fail(
          'NO_TENANT',
          'Session thiếu tenantId — đăng nhập lại',
          { status: 401 },
        );
      }

      // Rate limit: key theo userId + path để phân biệt endpoint
      if (opts?.rateLimit) {
        const pathname = new URL(req.url).pathname;
        const key = `${sessionUser.id}:${pathname}`;
        const rl = rateLimit(key, opts.rateLimit);
        if (!rl.allowed) {
          const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
          return fail('RATE_LIMITED', 'Quá nhiều request, vui lòng thử lại sau', {
            status: 429,
            details: { retryAfter },
          });
        }
      }

      // Mọi prisma query trong handler tự động scope theo tenantId.
      return await withTenant({ tenantId: sessionUser.tenantId }, () =>
        handler({
          req,
          params: routeCtx.params,
          user: sessionUser,
        }),
      );
    } catch (e) {
      if (e instanceof ZodError) {
        return fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', {
          status: 422,
          details: e.issues,
        });
      }
      if (e instanceof SyntaxError) {
        return fail('INVALID_JSON', 'Body không phải JSON hợp lệ', { status: 400 });
      }
      console.error('[API] Unhandled error:', e);
      return fail('INTERNAL_ERROR', 'Lỗi server', { status: 500 });
    }
  };
}
