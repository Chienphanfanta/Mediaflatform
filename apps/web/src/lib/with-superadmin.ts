// Wrapper enforce SUPERADMIN cho /api/v1/admin/* routes.
// Reuse withAuth + thêm role check trên top.
import { fail } from '@/lib/api-response';
import { withAuth } from '@/lib/with-auth';
import type { RateLimitOptions } from '@/lib/rate-limit';
import type { SessionUser } from '@/lib/rbac';

type Ctx<P> = { req: Request; params: P; user: SessionUser };
type Handler<P> = (ctx: Ctx<P>) => Promise<Response> | Response;

export function withSuperAdmin<
  P extends Record<string, string> = Record<string, string>,
>(handler: Handler<P>, opts?: { rateLimit?: RateLimitOptions }) {
  return withAuth<P>(async (ctx) => {
    if (!ctx.user.isSuperAdmin) {
      return fail('FORBIDDEN', 'Chỉ SUPERADMIN truy cập', { status: 403 });
    }
    return handler(ctx);
  }, opts);
}
