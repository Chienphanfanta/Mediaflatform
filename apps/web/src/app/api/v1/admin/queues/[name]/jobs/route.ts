// GET /api/v1/admin/queues/:name/jobs?status=&page=&pageSize= — list jobs.
import { fail, ok } from '@/lib/api-response';
import {
  listJobs,
  QUEUE_NAMES,
  type JobStatus,
  type QueueName,
} from '@/lib/queue-inspector';
import { withSuperAdmin } from '@/lib/with-superadmin';

export const dynamic = 'force-dynamic';

const VALID_STATUS: JobStatus[] = [
  'active',
  'waiting',
  'completed',
  'failed',
  'delayed',
  'paused',
];

export const GET = withSuperAdmin<{ name: string }>(async ({ req, params }) => {
  if (!QUEUE_NAMES.includes(params.name as QueueName)) {
    return fail('QUEUE_NOT_FOUND', `Queue không tồn tại: ${params.name}`, {
      status: 404,
    });
  }
  const url = new URL(req.url);
  const status = (url.searchParams.get('status') ?? 'failed') as JobStatus;
  if (!VALID_STATUS.includes(status)) {
    return fail('INVALID_STATUS', `status không hợp lệ: ${status}`, {
      status: 422,
    });
  }
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get('pageSize') ?? 20)),
  );

  const { items, total } = await listJobs(
    params.name as QueueName,
    status,
    page,
    pageSize,
  );

  return ok(items, {
    meta: {
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    },
  });
});
