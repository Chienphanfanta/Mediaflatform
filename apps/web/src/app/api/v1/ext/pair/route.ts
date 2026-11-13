// POST /api/v1/ext/pair — extension đổi mã ghép 6 ký tự lấy device token.
//   Body: { code, name, browser, os?, extensionVersion? }
//   → { token, device, user }  (token chỉ trả về DUY NHẤT lần này)
// Không cần session: mã ghép do nhân viên tạo trên web (đã đăng nhập), sống 10 phút, dùng 1 lần.
import type { NextRequest } from 'next/server';

import { fail, ok } from '@/lib/api-response';
import { generateDeviceToken } from '@/lib/posts/device-auth';
import { prisma, withTenantBypass } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { pairDeviceSchema } from '@/lib/schemas/posts';

export async function POST(req: NextRequest): Promise<Response> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = rateLimit(`ext-pair:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return fail('RATE_LIMITED', 'Thử quá nhiều lần, đợi 1 phút', { status: 429 });
  }

  const parsed = pairDeviceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', 'Thông tin ghép không hợp lệ', {
      status: 422,
      details: parsed.error.issues,
    });
  }
  const d = parsed.data;

  try {
    const result = await withTenantBypass(() =>
      prisma.$transaction(async (tx) => {
        const pair = await tx.devicePairCode.findUnique({ where: { code: d.code } });
        if (!pair || pair.expiresAt < new Date()) return null;
        // Dùng 1 lần
        await tx.devicePairCode.delete({ where: { code: pair.code } });

        const user = await tx.user.findFirst({
          where: { id: pair.userId, tenantId: pair.tenantId, status: 'ACTIVE', deletedAt: null },
          select: { id: true, name: true, email: true },
        });
        if (!user) return null;

        const { token, hash } = generateDeviceToken();
        const device = await tx.browserDevice.create({
          data: {
            tenantId: pair.tenantId,
            userId: user.id,
            name: d.name,
            browser: d.browser,
            os: d.os ?? null,
            extensionVersion: d.extensionVersion ?? null,
            tokenHash: hash,
            lastSeenAt: new Date(),
          },
          select: { id: true, name: true, browser: true, createdAt: true },
        });
        return { token, device, user };
      }),
    );

    if (!result) {
      return fail('PAIR_CODE_INVALID', 'Mã ghép sai hoặc đã hết hạn', { status: 400 });
    }
    return ok(result, { status: 201 });
  } catch (e) {
    console.error('[ext/pair]', e);
    return fail('INTERNAL_ERROR', 'Lỗi hệ thống', { status: 500 });
  }
}
