// GET   /api/v1/notifications/settings  — current toggles + device list
// PATCH /api/v1/notifications/settings  — update toggles
import { z } from 'zod';

import { fail, ok } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/with-auth';

const SETTINGS_KEYS = [
  'pushEnabled',
  'alertCritical',
  'alertHigh',
  'alertMedium',
  'postFailed',
  'taskDeadline',
  'workflowApproved',
  'workflowRejected',
  'workflowSubmitted',
  'inAppEnabled',
  'emailEnabled',
] as const;

const patchSchema = z.object(
  Object.fromEntries(
    SETTINGS_KEYS.map((k) => [k, z.boolean().optional()]),
  ) as Record<(typeof SETTINGS_KEYS)[number], z.ZodOptional<z.ZodBoolean>>,
);

export const GET = withAuth(async ({ user }) => {
  const [settings, devices] = await Promise.all([
    prisma.userNotificationSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    }),
    prisma.userDevice.findMany({
      where: { userId: user.id },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        endpoint: true,
        userAgent: true,
        lastSeenAt: true,
        createdAt: true,
      },
    }),
  ]);

  return ok({
    settings,
    devices: devices.map((d) => ({
      id: d.id,
      // KHÔNG trả full endpoint (chứa token nhạy cảm) — chỉ host + suffix mask
      endpointHost: safeHost(d.endpoint),
      userAgent: d.userAgent,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
    })),
  });
});

export const PATCH = withAuth(async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', 'Cài đặt không hợp lệ', {
      status: 422,
      details: parsed.error.issues,
    });
  }

  const settings = await prisma.userNotificationSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...parsed.data },
    update: parsed.data,
  });
  return ok(settings);
});

function safeHost(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return u.host;
  } catch {
    return 'unknown';
  }
}
