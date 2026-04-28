// Zod schemas cho /api/v1/alerts/*
import { z } from 'zod';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const TYPES = [
  'TOKEN_EXPIRING',
  'TOKEN_EXPIRED',
  'POLICY_VIOLATION',
  'COPYRIGHT_STRIKE',
  'VIEW_DROP',
  'MONETIZATION_LOST',
  'MONETIZATION_AT_RISK',
  'API_ERROR',
  'RATE_LIMIT',
  'CHANNEL_INACTIVE',
  'SCHEDULED_POST_FAILED',
  'DEADLINE_APPROACHING',
  'OTHER',
] as const;
const STATUSES = ['unread', 'read', 'all'] as const;

export const listAlertsQuerySchema = z.object({
  status: z.enum(STATUSES).default('all'),
  severity: z.array(z.enum(SEVERITIES)).default([]),
  type: z.array(z.enum(TYPES)).default([]),
  channelId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;

export const ALERT_SEVERITIES = SEVERITIES;
export const ALERT_TYPES = TYPES;
