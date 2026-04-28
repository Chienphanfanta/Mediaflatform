// Full NextAuth config: thêm Credentials provider (Node runtime).
// Import từ đây cho server components / route handlers.
//
// Multi-tenant V2: login lookup dùng `withTenantBypass` vì chưa biết tenantId
// trước khi match user. Sau khi match → JWT mang tenantId/tenantSlug.
//
// Lưu ý: email unique per-tenant. Nếu 2 tenants có cùng email → first match wins.
// Day 4+ sẽ add subdomain routing để disambiguate.

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { MemberRole } from '@prisma/client';

import authConfig from './auth.config';
import { prisma, withTenantBypass } from './lib/prisma';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        return withTenantBypass(async () => {
          const user = await prisma.user.findFirst({
            where: {
              email: parsed.data.email.toLowerCase(),
              deletedAt: null,
              status: 'ACTIVE',
            },
            include: {
              tenant: { select: { id: true, slug: true, status: true } },
              groupMembers: {
                include: { group: { select: { id: true, name: true, type: true } } },
              },
            },
          });
          if (!user) return null;
          if (user.tenant.status !== 'ACTIVE') return null;

          const ok = await bcrypt.compare(parsed.data.password, user.password);
          if (!ok) return null;

          // Load permission set theo từng MemberRole user đang dùng
          const rolesInUse = Array.from(
            new Set(user.groupMembers.map((m) => m.role)),
          );
          const rp = rolesInUse.length
            ? await prisma.rolePermission.findMany({
                where: { roleId: { in: rolesInUse } },
                include: {
                  permission: { select: { resource: true, action: true } },
                },
              })
            : [];

          const permsByRole = new Map<MemberRole, string[]>();
          for (const row of rp) {
            const list = permsByRole.get(row.roleId) ?? [];
            list.push(`${row.permission.resource}:${row.permission.action}`);
            permsByRole.set(row.roleId, list);
          }

          const groups = user.groupMembers.map((m) => ({
            id: m.groupId,
            name: m.group.name,
            type: m.group.type,
            role: m.role,
          }));

          const permissions: Record<string, string[]> = {};
          for (const m of user.groupMembers) {
            permissions[m.groupId] = permsByRole.get(m.role) ?? [];
          }

          const isSuperAdmin = groups.some(
            (g) => g.type === 'SYSTEM' && g.role === 'ADMIN',
          );

          return {
            id: user.id,
            tenantId: user.tenant.id,
            tenantSlug: user.tenant.slug,
            email: user.email,
            name: user.name,
            image: user.avatar ?? null,
            groups,
            permissions,
            isSuperAdmin,
          };
        });
      },
    }),
  ],
});
