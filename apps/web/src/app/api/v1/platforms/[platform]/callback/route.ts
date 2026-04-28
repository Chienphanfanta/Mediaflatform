// GET /api/v1/platforms/:platform/callback?code=...&state=...
// Verify state cookie, exchange code → tokens, encrypt + upsert Channel, redirect về /channels/connect.
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';
import { encryptToken, maskToken } from '@/lib/crypto/token-encryption';
import { FLOW_COOKIE, verifyState } from '@/lib/platform-oauth/state';
import { getAdapter, platformFromSlug } from '@/lib/platform-oauth';

function redirectWithError(origin: string, code: string): NextResponse {
  const url = new URL('/channels/connect', origin);
  url.searchParams.set('error', code);
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.delete(FLOW_COOKIE.name);
  return res;
}

function redirectWithSuccess(
  origin: string,
  channelId: string,
  platformSlug: string,
): NextResponse {
  const url = new URL('/channels/connect', origin);
  url.searchParams.set('success', '1');
  url.searchParams.set('channelId', channelId);
  url.searchParams.set('platform', platformSlug);
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.delete(FLOW_COOKIE.name);
  return res;
}

export const GET = withAuth<{ platform: string }>(
  async ({ req, user, params }) => {
    const url = new URL(req.url);
    const origin = url.origin;
    const platform = platformFromSlug(params.platform);
    if (!platform) return redirectWithError(origin, 'UNKNOWN_PLATFORM');

    // Provider có thể trả error trong query (vd user denied)
    const errParam = url.searchParams.get('error');
    if (errParam) return redirectWithError(origin, `PROVIDER_ERROR_${errParam}`);

    const code = url.searchParams.get('code');
    const stateFromUrl = url.searchParams.get('state');
    if (!code || !stateFromUrl) return redirectWithError(origin, 'MISSING_CODE');

    // Verify cookie state
    const cookie = req.cookies.get(FLOW_COOKIE.name)?.value;
    const flow = verifyState(cookie);
    if (!flow) return redirectWithError(origin, 'INVALID_OR_EXPIRED_STATE');
    if (flow.platform !== params.platform.toLowerCase()) {
      return redirectWithError(origin, 'STATE_PLATFORM_MISMATCH');
    }
    if (flow.nonce !== stateFromUrl) {
      return redirectWithError(origin, 'STATE_NONCE_MISMATCH');
    }

    // Exchange code → tokens
    const adapter = getAdapter(platform);
    let tokenSet;
    try {
      tokenSet = await adapter.exchangeCode({
        code,
        redirectUri: flow.redirectUri,
        codeVerifier: flow.codeVerifier,
      });
    } catch (e) {
      console.error(
        `[oauth callback] ${platform} exchange failed:`,
        (e as Error).message,
      );
      return redirectWithError(origin, 'EXCHANGE_FAILED');
    }

    // Upsert Channel — encrypt token TRƯỚC khi ghi DB
    const encryptedAccess = encryptToken(tokenSet.accessToken);
    const encryptedRefresh = tokenSet.refreshToken
      ? encryptToken(tokenSet.refreshToken)
      : null;

    let channelId: string;
    try {
      const channel = await prisma.channel.upsert({
        where: {
          tenantId_platform_accountId: {
            tenantId: user.tenantId,
            platform,
            accountId: tokenSet.account.externalId,
          },
        },
        create: {
          tenantId: user.tenantId,
          name: tokenSet.account.name,
          platform,
          accountId: tokenSet.account.externalId,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiresAt: tokenSet.expiresAt,
          status: 'ACTIVE',
          metadata: {
            ...tokenSet.account.metadata,
            tokenScope: tokenSet.scope,
            connectedAt: new Date().toISOString(),
            connectedBy: user.id,
          } as Prisma.InputJsonValue,
          groups: { create: { groupId: flow.groupId } },
          ownerships: {
            create: {
              employeeId: user.id,
              role: 'PRIMARY',
              assignedById: user.id,
            },
          },
        },
        update: {
          name: tokenSet.account.name,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiresAt: tokenSet.expiresAt,
          status: 'ACTIVE',
          metadata: {
            ...tokenSet.account.metadata,
            tokenScope: tokenSet.scope,
            reconnectedAt: new Date().toISOString(),
            reconnectedBy: user.id,
          } as Prisma.InputJsonValue,
          deletedAt: null,
        },
      });

      // Đảm bảo group link tồn tại (cho cả case upsert update không touch groups)
      await prisma.channelGroup.upsert({
        where: {
          channelId_groupId: { channelId: channel.id, groupId: flow.groupId },
        },
        create: { channelId: channel.id, groupId: flow.groupId },
        update: {},
      });

      channelId = channel.id;
    } catch (e) {
      console.error(
        `[oauth callback] DB upsert failed for ${platform} (token: ${maskToken(tokenSet.accessToken)}):`,
        (e as Error).message,
      );
      return redirectWithError(origin, 'DB_ERROR');
    }

    return redirectWithSuccess(origin, channelId, params.platform.toLowerCase());
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
