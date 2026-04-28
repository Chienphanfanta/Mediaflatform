// Tenant context — AsyncLocalStorage giữ tenantId xuyên suốt 1 request.
//
// Dùng:
//   import { withTenant, withTenantBypass, getTenantContext } from '@media-ops/db';
//
//   // Từ middleware sau khi auth:
//   await withTenant({ tenantId: session.tenantId }, async () => {
//     // mọi prisma query trong block này tự động filter theo tenantId
//     return await someHandler();
//   });
//
//   // System ops (login lookup, super-admin maintenance):
//   await withTenantBypass(async () => {
//     return await prisma.user.findUnique({ where: { email } });
//   });
import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantContext = {
  /** ID của tenant đang phục vụ request — bắt buộc ngoại trừ bypass mode */
  tenantId: string;
  /** Bỏ qua tenant filter — chỉ dùng cho system ops (auth lookup, cron, super-admin) */
  bypass?: boolean;
};

const storage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Run callback trong tenant context. Mọi prisma query trong callback
 * (kể cả gọi nested async) tự động scoped theo tenantId.
 */
export function withTenant<T>(
  context: TenantContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(storage.run(context, fn) as T | Promise<T>);
}

/**
 * Run callback bypass tenant filter — chỉ dùng cho:
 *   - Auth login lookup (chưa biết tenant trước khi match user)
 *   - Cron/queue jobs xử lý cross-tenant
 *   - Super-admin maintenance
 *   - Unit tests
 *
 * KHÔNG dùng trong route handler thường — sẽ leak data cross-tenant.
 */
export function withTenantBypass<T>(fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(
    storage.run({ tenantId: '__bypass__', bypass: true }, fn) as T | Promise<T>,
  );
}
