// GET /api/v1/platforms/:platform/connect?groupId=xxx
// Bắt đầu OAuth flow. Set HttpOnly cookie chứa state + (optional) PKCE verifier,
// redirect 302 đến OAuth URL của platform.
//
// Telegram: trả 400 vì cần POST bot token — UI nên detect trước và route khác.
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasPermission } from '@/lib/rbac';
import { withAuth } from '@/lib/with-auth';
import { fail } from '@/lib/api-response';
import { FLOW_COOKIE, signState } from '@/lib/platform-oauth/state';
import { getAdapter, platformFromSlug } from '@/lib/platform-oauth';

const querySchema = z.object({
  groupId: z.string().min(1, 'groupId bắt buộc'),
});

export const GET = withAuth<{ platform: string }>(
  async ({ req, user, params }) => {
    const platform = platformFromSlug(params.platform);
    if (!platform) {
      return fail('UNKNOWN_PLATFORM', `Platform không hợp lệ: ${params.platform}`, {
        status: 404,
      });
    }
    if (platform === 'TELEGRAM') {
      return fail('TELEGRAM_USES_BOT_TOKEN', 'Telegram dùng bot token — POST /api/v1/platforms/telegram/connect-bot', {
        status: 400,
      });
    }

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({ groupId: url.searchParams.get('groupId') });
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Query không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }
    const { groupId } = parsed.data;

    // Check user thuộc group + có permission channel:CREATE
    const isMember = user.isSuperAdmin || user.groups.some((g) => g.id === groupId);
    if (!isMember) {
      return fail('FORBIDDEN', 'Bạn không thuộc group này', { status: 403 });
    }
    const canCreate =
      user.isSuperAdmin ||
      hasPermission(user, 'channel', 'CREATE', { groupId }) ||
      hasPermission(user, 'channel', 'FULL', { groupId });
    if (!canCreate) {
      return fail('FORBIDDEN', 'Không có quyền tạo channel trong group này', {
        status: 403,
      });
    }

    const adapter = getAdapter(platform);
    const redirectUri =
      process.env[`${platform}_REDIRECT_URI`] ??
      `${url.origin}/api/v1/platforms/${params.platform.toLowerCase()}/callback`;

    let authResult;
    try {
      authResult = adapter.generateAuthUrl({
        redirectUri,
        // state placeholder — sẽ dùng nonce từ flow state làm CSRF token thật
        state: 'pending',
      });
    } catch (e) {
      return fail('OAUTH_CONFIG_ERROR', (e as Error).message, { status: 500 });
    }
    if (!authResult) {
      return fail('NOT_OAUTH', 'Platform này không dùng OAuth flow', { status: 400 });
    }

    // Sign cookie state với nonce + (optional) PKCE verifier
    const flowToken = signState({
      platform: params.platform.toLowerCase(),
      groupId,
      redirectUri,
      codeVerifier: authResult.codeVerifier,
    });

    // Lấy nonce từ token đã sign (decode payload — same secret nên match callback)
    // Đơn giản hơn: regen flow với nonce explicit + dùng nó cả 2 chỗ.
    const nonce = parseNonce(flowToken);

    // Replace state placeholder bằng nonce
    const finalUrl = new URL(authResult.url);
    finalUrl.searchParams.set('state', nonce);

    const res = NextResponse.redirect(finalUrl.toString(), { status: 302 });
    res.cookies.set(FLOW_COOKIE.name, flowToken, FLOW_COOKIE.options);
    return res;
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);

function parseNonce(signedToken: string): string {
  const [encoded] = signedToken.split('.');
  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      nonce: string;
    };
    return data.nonce;
  } catch {
    throw new Error('Failed to parse signed state');
  }
}
