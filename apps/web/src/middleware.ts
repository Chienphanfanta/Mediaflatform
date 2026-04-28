// Edge middleware - chỉ dùng auth.config (không import Prisma/bcrypt).
// Logic gate đã ở trong `authorized` callback của auth.config.
import NextAuth from 'next-auth';
import authConfig from '@/auth.config';

export default NextAuth(authConfig).auth;

export const config = {
  // Bỏ qua: internals, static, api/auth, file đuôi tĩnh
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*$).*)'],
};
