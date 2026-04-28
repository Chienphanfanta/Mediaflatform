import { z } from 'zod';

export const REPORT_TYPES = ['CHANNEL', 'HR'] as const;
export const REPORT_FORMATS = ['PDF', 'CSV', 'JSON'] as const;
export const REPORT_PERIODS = ['7d', '30d', '90d', 'custom'] as const;

export const generateReportSchema = z
  .object({
    type: z.enum(REPORT_TYPES),
    period: z.enum(REPORT_PERIODS).default('30d'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    channelIds: z.array(z.string().min(1)).max(50).optional(),
    groupId: z.string().min(1).optional(),
    format: z.enum(REPORT_FORMATS).default('JSON'),
  })
  .refine(
    (d) => d.period !== 'custom' || (d.from && d.to),
    { message: 'period=custom phải kèm from + to', path: ['from'] },
  )
  .refine(
    (d) => !d.from || !d.to || d.to >= d.from,
    { message: 'to phải >= from', path: ['to'] },
  );
export type GenerateReportInput = z.infer<typeof generateReportSchema>;
