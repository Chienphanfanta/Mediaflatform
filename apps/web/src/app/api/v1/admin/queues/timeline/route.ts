// GET /api/v1/admin/queues/timeline — 24h hourly bucket cho bar chart.
import { ok } from '@/lib/api-response';
import { getTimeline24h } from '@/lib/queue-inspector';
import { withSuperAdmin } from '@/lib/with-superadmin';

export const dynamic = 'force-dynamic';

export const GET = withSuperAdmin(async () => {
  const data = await getTimeline24h();
  return ok(data);
});
