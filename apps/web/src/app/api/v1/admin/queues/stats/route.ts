// GET /api/v1/admin/queues/stats — overview cards data cho /settings/queues.
import { ok } from '@/lib/api-response';
import { getAllQueueStats } from '@/lib/queue-inspector';
import { withSuperAdmin } from '@/lib/with-superadmin';

export const dynamic = 'force-dynamic'; // không cache, real-time stats

export const GET = withSuperAdmin(async () => {
  const stats = await getAllQueueStats();
  return ok(stats);
});
