// POST /api/v1/admin/queues/:name/jobs/:id/retry — re-enqueue failed job.
import { fail, ok } from '@/lib/api-response';
import {
  QUEUE_NAMES,
  retryJob,
  type QueueName,
} from '@/lib/queue-inspector';
import { withSuperAdmin } from '@/lib/with-superadmin';

export const dynamic = 'force-dynamic';

export const POST = withSuperAdmin<{ name: string; id: string }>(
  async ({ params }) => {
    if (!QUEUE_NAMES.includes(params.name as QueueName)) {
      return fail('QUEUE_NOT_FOUND', `Queue không tồn tại: ${params.name}`, {
        status: 404,
      });
    }
    const r = await retryJob(params.name as QueueName, params.id);
    if (!r.ok) {
      return fail('RETRY_FAILED', `Không retry được: ${r.reason}`, {
        status: r.reason === 'job-not-found' ? 404 : 422,
      });
    }
    return ok({ ok: true });
  },
  { rateLimit: { limit: 20, windowMs: 60_000 } },
);
