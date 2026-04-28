// Prisma client extension — auto-inject tenantId filter cho tất cả query
// trên các tenant-scoped models (User, Group, Channel, Analytics, Alert).
//
// Strict mode: throw nếu query không có tenant context (trừ bypass mode).
//
// Junction tables (ChannelOwnership, ChannelGroup, GroupMember) KHÔNG được
// filter trực tiếp — derive tenant qua parent FK. Permission/RolePermission
// là global (system-shared).
//
// Cách dùng: xem packages/db/src/tenant-context.ts.
import { Prisma } from '@prisma/client';
import { getTenantContext } from './tenant-context';

const TENANT_SCOPED_MODELS = new Set([
  'User',
  'Group',
  'Channel',
  'Analytics',
  'Alert',
  'KPI',
]);

const READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const UNIQUE_READ_OPS = new Set(['findUnique', 'findUniqueOrThrow']);

const MUTATE_MANY_OPS = new Set(['updateMany', 'deleteMany']);

const MUTATE_UNIQUE_OPS = new Set(['update', 'delete']);

export function tenantExtension() {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const ctx = getTenantContext();
          if (!ctx) {
            throw new Error(
              `[tenant-isolation] ${model}.${operation}() called without tenant context. ` +
                `Wrap call in withTenant({ tenantId }, ...) or withTenantBypass(...).`,
            );
          }
          if (ctx.bypass) {
            return query(args);
          }

          const tenantFilter = { tenantId: ctx.tenantId };
          const a = args as Record<string, unknown>;

          // ── READ many / aggregate ──
          if (READ_OPS.has(operation)) {
            a.where = { ...((a.where as object) ?? {}), ...tenantFilter };
            return query(a);
          }

          // ── READ unique (findUnique / findUniqueOrThrow) ──
          // Prisma 5 stable: extendedWhereUnique cho phép thêm filter ngoài unique key.
          if (UNIQUE_READ_OPS.has(operation)) {
            a.where = { ...((a.where as object) ?? {}), ...tenantFilter };
            return query(a);
          }

          // ── CREATE ──
          if (operation === 'create') {
            const data = (a.data as Record<string, unknown>) ?? {};
            a.data = { ...data, tenantId: data.tenantId ?? ctx.tenantId };
            return query(a);
          }

          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const raw = a.data;
            const list = Array.isArray(raw) ? raw : [raw];
            a.data = list.map((d) => {
              const obj = (d as Record<string, unknown>) ?? {};
              return { ...obj, tenantId: obj.tenantId ?? ctx.tenantId };
            });
            return query(a);
          }

          // ── UPDATE / DELETE many ──
          if (MUTATE_MANY_OPS.has(operation)) {
            a.where = { ...((a.where as object) ?? {}), ...tenantFilter };
            return query(a);
          }

          // ── UPDATE / DELETE unique ──
          if (MUTATE_UNIQUE_OPS.has(operation)) {
            a.where = { ...((a.where as object) ?? {}), ...tenantFilter };
            return query(a);
          }

          // ── UPSERT ──
          if (operation === 'upsert') {
            a.where = { ...((a.where as object) ?? {}), ...tenantFilter };
            const create = (a.create as Record<string, unknown>) ?? {};
            a.create = { ...create, tenantId: create.tenantId ?? ctx.tenantId };
            return query(a);
          }

          // Unknown op — pass through (Prisma có thể thêm op mới, không break)
          return query(a);
        },
      },
    },
  });
}
