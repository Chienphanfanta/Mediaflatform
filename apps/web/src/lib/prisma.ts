// Prisma client singleton + tenant extension.
//
// Mọi query trên User/Group/Channel/Analytics/Alert sẽ tự động scope theo
// tenantId từ AsyncLocalStorage context. Auth/middleware phải set context
// qua `withTenant({tenantId}, async () => ...)` trước khi gọi DB.
//
// System ops (login lookup, cron, super-admin) → dùng `withTenantBypass(...)`.
import { PrismaClient } from '@prisma/client';
import { tenantExtension } from '@media-ops/db';

function buildClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
  return base.$extends(tenantExtension());
}

type ExtendedPrisma = ReturnType<typeof buildClient>;

const g = globalThis as unknown as { prisma?: ExtendedPrisma };

export const prisma: ExtendedPrisma = g.prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

// Re-export context helpers cho convenience trong route handlers.
export { withTenant, withTenantBypass, getTenantContext } from '@media-ops/db';
export type { TenantContext } from '@media-ops/db';
