// Full NextAuth config: thêm Credentials provider (Node runtime).
// Import từ đây cho server components / route handlers.

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { MemberRole } from '@prisma/client';

import authConfig from './auth.config';
import { prisma } from './lib/prisma';

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

        const user = await prisma.user.findFirst({
          where: {
            email: parsed.data.email.toLowerCase(),
            deletedAt: null,
            status: 'ACTIVE',
          },
          include: {
            groupMembers: {
              include: { group: { select: { id: true, name: true, type: true } } },
            },
          },
        });
        if (!user) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.password);
        if (!ok) return null;

        // Load tập permission theo từng MemberRole mà user đang dùng
        const rolesInUse = Array.from(new Set(user.groupMembers.map((m) => m.role)));
        const rp = rolesInUse.length
          ? await prisma.rolePermission.findMany({
              where: { roleId: { in: rolesInUse } },
              include: { permission: { select: { resource: true, action: true } } },
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

        // Precompute permissions per-group → embed vào JWT để client/edge check nhanh
        const permissions: Record<string, string[]> = {};
        for (const m of user.groupMembers) {
          permissions[m.groupId] = permsByRole.get(m.role) ?? [];
        }

        const isSuperAdmin = groups.some((g) => g.type === 'SYSTEM' && g.role === 'ADMIN');

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatar ?? null,
          groups,
          permissions,
          isSuperAdmin,
        };
      },
    }),
  ],
});
