// GET    /api/v1/admin/queues/:name/jobs/:id  — job detail (full data + stack)
// DELETE /api/v1/admin/queues/:name/jobs/:id  — remove job
import { fail, noContent, ok } from '@/lib/api-response';
import {
  getJobDetail,
  QUEUE_NAMES,
  removeJob,
  type QueueName,
} from '@/lib/queue-inspector';
import { withSuperAdmin } from '@/lib/with-superadmin';

export const dynamic = 'force-dynamic';

function validateQueue(name: string) {
  if (QUEUE_NAMES.includes(name as QueueName)) return null;
  return fail('QUEUE_NOT_FOUND', `Queue không tồn tại: ${name}`, { status: 404 });
}

export const GET = withSuperAdmin<{ name: string; id: string }>(async ({ params }) => {
  const err = validateQueue(params.name);
  if (err) return err;
  const job = await getJobDetail(params.name as QueueName, params.id);
  if (!job) return fail('JOB_NOT_FOUND', 'Không tìm thấy job', { status: 404 });
  return ok(job);
});

export const DELETE = withSuperAdmin<{ name: string; id: string }>(
  async ({ params }) => {
    const err = validateQueue(params.name);
    if (err) return err;
    const r = await removeJob(params.name as QueueName, params.id);
    if (!r.ok) {
      return fail('REMOVE_FAILED', `Không xoá được: ${r.reason}`, {
        status: r.reason === 'job-not-found' ? 404 : 422,
      });
    }
    return noContent();
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);
