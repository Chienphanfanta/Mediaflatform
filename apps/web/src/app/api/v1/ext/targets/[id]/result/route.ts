// POST /api/v1/ext/targets/:id/result — extension báo kết quả đăng.
//   { success: true, externalUrl? }
//   { success: false, error, retryable? }  retryable + còn lượt → PENDING, ngược lại FAILED
import { fail, ok } from '@/lib/api-response';
import { refreshPostStatus } from '@/lib/posts/access';
import { MAX_ATTEMPTS } from '@/lib/posts/constants';
import { withDevice } from '@/lib/posts/device-auth';
import { prisma } from '@/lib/prisma';
import { targetResultSchema } from '@/lib/schemas/posts';

export const POST = withDevice<{ id: string }>(async ({ req, params, device }) => {
  const parsed = targetResultSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', 'Kết quả không hợp lệ', {
      status: 422,
      details: parsed.error.issues,
    });
  }
  const r = parsed.data;

  const target = await prisma.postTarget.findUnique({
    where: { id: params.id },
    select: { id: true, postId: true, status: true, deviceId: true, attempts: true },
  });
  if (!target || target.deviceId !== device.id || target.status !== 'PUBLISHING') {
    return fail('NOT_CLAIMED', 'Trình duyệt này không giữ bài đăng này', { status: 409 });
  }

  if (r.success) {
    await prisma.postTarget.update({
      where: { id: target.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        externalUrl: r.externalUrl ?? null,
        errorMessage: null,
      },
    });
  } else {
    const retry = r.retryable && target.attempts < MAX_ATTEMPTS;
    await prisma.postTarget.update({
      where: { id: target.id },
      data: retry
        ? { status: 'PENDING', deviceId: null, claimedAt: null, errorMessage: r.error }
        : { status: 'FAILED', errorMessage: r.error },
    });
  }

  const postStatus = await refreshPostStatus(target.postId);
  return ok({ targetId: target.id, postStatus });
});
