// Augment types cho NextAuth — thêm groups, permissions, isSuperAdmin vào session + JWT.
import type { GroupType, MemberRole } from '@prisma/client';

type UserGroup = { id: string; name: string; type: GroupType; role: MemberRole };

declare module 'next-auth' {
  interface User {
    id?: string;
    groups?: UserGroup[];
    permissions?: Record<string, string[]>;
    isSuperAdmin?: boolean;
  }

  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      groups: UserGroup[];
      permissions: Record<string, string[]>;
      isSuperAdmin: boolean;
    };
  }
}

// NextAuth v5 exposes JWT from both paths — khai báo cả hai cho chắc.
declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    groups: UserGroup[];
    permissions: Record<string, string[]>;
    isSuperAdmin: boolean;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string;
    groups: UserGroup[];
    permissions: Record<string, string[]>;
    isSuperAdmin: boolean;
  }
}
