// Dialog xem full job data + stack trace + nút Retry/Delete.
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Trash2, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

type JobDetail = {
  id: string;
  name: string;
  status: string;
  data: unknown;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: string;
  processedOn: number | null;
  finishedOn: number | null;
  durationMs: number | null;
  failedReason: string | null;
  stacktrace: string[];
  returnvalue: unknown;
};

export function JobDetailDialog({
  queueName,
  jobId,
  open,
  onOpenChange,
}: {
  queueName: string;
  jobId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const { data: job, isLoading } = useQuery<JobDetail>({
    queryKey: ['job', queueName, jobId],
    enabled: !!jobId && open,
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/admin/queues/${queueName}/jobs/${jobId}`,
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? 'Lỗi');
      return json.data as JobDetail;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['queue-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['queue-stats'] });
  };

  const retry = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/v1/admin/queues/${queueName}/jobs/${jobId}/retry`,
        { method: 'POST' },
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? 'Retry thất bại');
      return json.data;
    },
    onSuccess: () => {
      refresh();
      onOpenChange(false);
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/v1/admin/queues/${queueName}/jobs/${jobId}`,
        { method: 'DELETE' },
      );
      if (res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error?.message ?? 'Xoá thất bại');
      }
    },
    onSuccess: () => {
      refresh();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Job {jobId} <span className="text-muted-foreground">· {queueName}</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading || !job ? (
          <div className="text-sm text-muted-foreground">Đang tải...</div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'}>
                {job.status}
              </Badge>
              <Badge variant="outline">{job.name}</Badge>
              <span className="text-xs text-muted-foreground">
                {format(new Date(job.createdAt), 'HH:mm:ss dd/MM/yyyy')}
              </span>
            </div>

            <KeyValueGrid
              rows={[
                ['Attempts', `${job.attemptsMade}/${job.maxAttempts}`],
                [
                  'Duration',
                  job.durationMs !== null
                    ? `${job.durationMs.toLocaleString('vi-VN')}ms`
                    : '—',
                ],
                [
                  'Processed at',
                  job.processedOn
                    ? format(new Date(job.processedOn), 'HH:mm:ss dd/MM')
                    : '—',
                ],
                [
                  'Finished at',
                  job.finishedOn
                    ? format(new Date(job.finishedOn), 'HH:mm:ss dd/MM')
                    : '—',
                ],
              ]}
            />

            <Separator />

            <Section label="Job data">
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(job.data, null, 2)}
              </pre>
            </Section>

            {job.failedReason && (
              <Section label="Failed reason">
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                  {job.failedReason}
                </pre>
              </Section>
            )}

            {job.stacktrace.length > 0 && (
              <Section label="Stack trace">
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {job.stacktrace.join('\n\n')}
                </pre>
              </Section>
            )}

            {job.returnvalue !== undefined && job.returnvalue !== null && (
              <Section label="Return value">
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(job.returnvalue, null, 2)}
                </pre>
              </Section>
            )}

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                size="sm"
                onClick={() => retry.mutate()}
                disabled={job.status !== 'failed' || retry.isPending}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {retry.isPending ? 'Đang retry...' : 'Retry'}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {remove.isPending ? 'Đang xoá...' : 'Delete'}
              </Button>
            </div>
            {(retry.isError || remove.isError) && (
              <p className="text-sm text-destructive">
                {((retry.error ?? remove.error) as Error)?.message}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KeyValueGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="flex">
          <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
          <dd className="font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      {children}
    </div>
  );
}
