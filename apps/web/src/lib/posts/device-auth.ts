// Xác thực browser extension bằng device token (Authorization: Bearer mfx_...).
//
// - Token sinh 1 lần khi ghép thiết bị, chỉ trả về cho extension, DB lưu SHA-256.
// - Mỗi request: tìm device theo hash (bypass tenant vì chưa biết tenant), kiểm tra
//   chưa bị thu hồi + user còn ACTIVE, rồi chạy handler trong withTenant(device.tenantId).
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import { fail } from '@/lib/api-response';
import { prisma, withTenant, withTenantBypass } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';

const TOKEN_PREFIX = 'mfx_';

export type DeviceContext = {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  browser: string;
};

export function generateDeviceToken(): { token: string; hash: string } {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Mã ghép 6 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/I). */
export function generatePairCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

type Ctx<P> = { req: NextRequest; params: P; device: DeviceContext };
type Handler<P> = (ctx: Ctx<P>) => Promise<Response> | Response;

export function withDevice<P extends Record<string, string> = Record<string, string>>(
  handler: Handler<P>,
) {
  return async (req: NextRequest, routeCtx: { params: P }): Promise<Response> => {
    try {
      const header = req.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token.startsWith(TOKEN_PREFIX)) {
        return fail('UNAUTHORIZED', 'Thiếu device token', { status: 401 });
      }

      const rl = rateLimit(`device:${token.slice(-12)}`, { limit: 120, windowMs: 60_000 });
      if (!rl.allowed) {
        return fail('RATE_LIMITED', 'Quá nhiều request từ extension', { status: 429 });
      }

      const device = await withTenantBypass(() =>
        prisma.browserDevice.findUnique({
          where: { tokenHash: hashDeviceToken(token) },
          select: {
            id: true,
            tenantId: true,
            userId: true,
            name: true,
            browser: true,
            revokedAt: true,
            user: { select: { status: true, deletedAt: true } },
          },
        }),
      );
      if (!device || device.revokedAt) {
        return fail('DEVICE_REVOKED', 'Trình duyệt này đã bị thu hồi hoặc chưa ghép', {
          status: 401,
        });
      }
      if (device.user.status !== 'ACTIVE' || device.user.deletedAt) {
        return fail('USER_INACTIVE', 'Tài khoản nhân viên đã bị khoá', { status: 403 });
      }

      return await withTenant({ tenantId: device.tenantId }, () =>
        handler({
          req,
          params: routeCtx.params,
          device: {
            id: device.id,
            tenantId: device.tenantId,
            userId: device.userId,
            name: device.name,
            browser: device.browser,
          },
        }),
      );
    } catch (e) {
      if (e instanceof ZodError) {
        return fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', {
          status: 422,
          details: e.issues,
        });
      }
      console.error('[withDevice]', e);
      return fail('INTERNAL_ERROR', 'Lỗi hệ thống', { status: 500 });
    }
  };
}
