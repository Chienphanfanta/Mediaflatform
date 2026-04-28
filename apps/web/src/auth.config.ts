// Edge-safe NextAuth config: KHÔNG import Prisma/bcrypt ở đây.
// Providers thật (Credentials + Prisma) nằm ở ./auth.ts (Node runtime).
// Middleware dùng file này để check RBAC ở edge.

import type { NextAuthConfig } from 'next-auth';
import { NextResponse } from 'next/server';
import { meetsRole, type EffectiveRole, type SessionUser } from '@/lib/rbac';

// Ánh xạ prefix URL → role tối thiểu cần có.
// Lưu ý: SUPERADMIN luôn pass vì ROLE_RANK cao nhất.
const ROUTE_RBAC: Array<{ pattern: RegExp; minRole: EffectiveRole }> = [
  { pattern: /^\/admin(\/|$)/, minRole: 'SUPERADMIN' },
  // /settings/queues riêng: SUPERADMIN only (queue monitor expose internal state)
  { pattern: /^\/settings\/queues(\/|$)/, minRole: 'SUPERADMIN' },
  { pattern: /^\/settings(\/|$)/, minRole: 'GROUP_ADMIN' },
  { pattern: /^\/hr(\/|$)/, minRole: 'MANAGER' },
  { pattern: /^\/review(\/|$)/, minRole: 'MANAGER' },
  { pattern: /^\/reports(\/|$)/, minRole: 'MANAGER' },
  { pattern: /^\/alerts(\/|$)/, minRole: 'VIEWER' },
  { pattern: /^\/channels(\/|$)/, minRole: 'STAFF' },
  { pattern: /^\/calendar(\/|$)/, minRole: 'STAFF' },
  { pattern: /^\/analytics(\/|$)/, minRole: 'VIEWER' },
  { pattern: /^\/dashboard(\/|$)/, minRole: 'VIEWER' },
];

// /offline + /manifest.json + /icons + sw.js public — service worker fallback
// + PWA install không phụ thuộc session.
const PUBLIC_PREFIXES = [
  '/login',
  '/forbidden',
  '/offline',
  '/api/auth',
  '/manifest.json',
  '/icons',
  '/sw.js',
  '/workbox-',
];

export default {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 }, // 7 ngày

  // Providers trống ở đây — auth.ts sẽ spread config này rồi thêm Credentials.
  providers: [],

  callbacks: {
    // Edge middleware gate. Trả false → redirect về /login; trả Response → dùng trực tiếp.
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;

      // Root "/" cho server component tự xử lý (redirect theo session)
      if (pathname === '/') return true;

      if (!auth?.user) return false;

      const match = ROUTE_RBAC.find((r) => r.pattern.test(pathname));
      if (!match) return true; // route không được list → cho phép (mặc định đã đăng nhập)

      const user = auth.user as unknown as SessionUser;
      if (meetsRole(user, match.minRole)) return true;

      // Đã đăng nhập nhưng thiếu role → /forbidden, không phải /login
      return NextResponse.redirect(new URL('/forbidden', request.url));
    },

    async jwt({ token, user }) {
      // Chỉ set 1 lần khi login (user object có)
      if (user) {
        token.id = (user.id ?? token.sub) as string;
        token.tenantId = (user.tenantId ?? '') as string;
        token.tenantSlug = (user.tenantSlug ?? '') as string;
        token.groups = user.groups ?? [];
        token.permissions = user.permissions ?? {};
        token.isSuperAdmin = user.isSuperAdmin ?? false;
      }
      return token;
    },

    async session({ session, token }) {
      session.user.id = token.id;
      session.user.tenantId = token.tenantId;
      session.user.tenantSlug = token.tenantSlug;
      session.user.groups = token.groups;
      session.user.permissions = token.permissions;
      session.user.isSuperAdmin = token.isSuperAdmin;
      return session;
    },
  },
} satisfies NextAuthConfig;
