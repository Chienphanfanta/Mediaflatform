// Zod schemas cho /api/v1/kpi.
import { z } from 'zod';

const SCOPE = z.enum(['PER_CHANNEL', 'PER_EMPLOYEE']);
const PERIOD_TYPE = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']);
const STATUS = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'ACHIEVED',
  'EXCEEDED',
  'MISSED',
]);

const TARGETS = {
  targetFollowers: z.number().int().nonnegative().optional().nullable(),
  targetFollowersGain: z.number().int().optional().nullable(),
  targetViews: z.number().int().nonnegative().optional().nullable(),
  targetWatchTime: z.number().nonnegative().optional().nullable(),
  targetEngagement: z.number().nonnegative().max(100).optional().nullable(),
};

export const createKpiSchema = z
  .object({
    scope: SCOPE,
    channelId: z.string().min(1).optional(),
    employeeId: z.string().min(1),
    periodType: PERIOD_TYPE,
    periodStart: z.coerce.date(),
    notes: z.string().max(500).optional().nullable(),
    ...TARGETS,
  })
  .refine(
    (d) => (d.scope === 'PER_CHANNEL' ? !!d.channelId : true),
    { message: 'PER_CHANNEL scope phải kèm channelId', path: ['channelId'] },
  )
  .refine(
    (d) =>
      d.targetFollowers != null ||
      d.targetFollowersGain != null ||
      d.targetViews != null ||
      d.targetWatchTime != null ||
      d.targetEngagement != null,
    { message: 'Phải set ít nhất 1 target', path: ['targetFollowers'] },
  );
export type CreateKpiInput = z.infer<typeof createKpiSchema>;

export const updateKpiSchema = z.object({
  notes: z.string().max(500).optional().nullable(),
  ...TARGETS,
});
export type UpdateKpiInput = z.infer<typeof updateKpiSchema>;

export const bulkAssignKpiSchema = z
  .object({
    employeeIds: z.array(z.string().min(1)).min(1).max(100),
    scope: SCOPE,
    channelId: z.string().min(1).optional(),
    periodType: PERIOD_TYPE,
    periodStart: z.coerce.date(),
    notes: z.string().max(500).optional().nullable(),
    ...TARGETS,
  })
  .refine(
    (d) => (d.scope === 'PER_CHANNEL' ? !!d.channelId : true),
    { message: 'PER_CHANNEL scope phải kèm channelId', path: ['channelId'] },
  );
export type BulkAssignKpiInput = z.infer<typeof bulkAssignKpiSchema>;

export const kpiListQuerySchema = z.object({
  employeeId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  scope: SCOPE.optional(),
  periodType: PERIOD_TYPE.optional(),
  status: STATUS.optional(),
  /** ISO date — list KPIs có period chứa date này */
  activeOn: z.coerce.date().optional(),
});
export type KpiListQuery = z.infer<typeof kpiListQuerySchema>;
