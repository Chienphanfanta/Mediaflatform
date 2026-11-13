// POST /api/v1/devices/pair-code — tạo mã ghép 6 ký tự (sống 10 phút) để nhập vào extension.
import { ok } from '@/lib/api-response';
import { generatePairCode } from '@/lib/posts/device-auth';
import { prisma, withTenantBypass } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

const TTL_MS = 10 * 60 * 1000;

export const POST = withAuth(
  async ({ user }) => {
    const expiresAt = new Date(Date.now() + TTL_MS);
    // DevicePairCode là bảng global (không tenant-scoped)
    const code = await withTenantBypass(async () => {
      await prisma.devicePairCode.deleteMany({
        where: { OR: [{ userId: user.id }, { expiresAt: { lt: new Date() } }] },
      });
      for (let i = 0; i < 5; i++) {
        const candidate = generatePairCode();
        try {
          await prisma.devicePairCode.create({
            data: { code: candidate, tenantId: user.tenantId, userId: user.id, expiresAt },
          });
          return candidate;
        } catch (e) {
          if ((e as { code?: string }).code !== 'P2002') throw e; // trùng mã → thử lại
        }
      }
      throw new Error('Không tạo được mã ghép, thử lại');
    });
    return ok({ code, expiresAt }, { status: 201 });
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);
