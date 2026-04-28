// Zod schemas for /api/v1/channels CRUD + ownership endpoints.
import { z } from 'zod';

const PLATFORM_VALUES = [
  'YOUTUBE',
  'FACEBOOK',
  'INSTAGRAM',
  'X',
  'TELEGRAM',
  'WHATSAPP',
] as const;

const STATUS_VALUES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

export const createChannelSchema = z.object({
  name: z.string().min(1).max(120),
  platform: z.enum(PLATFORM_VALUES),
  accountId: z.string().min(1).max(120),
  externalUrl: z.string().url().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  groupIds: z.array(z.string().min(1)).max(20).optional(),
  primaryOwnerId: z.string().min(1).optional(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  externalUrl: z.string().url().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  status: z.enum(STATUS_VALUES).optional(),
});

export const assignOwnerSchema = z.object({
  employeeId: z.string().min(1),
  role: z.enum(['PRIMARY', 'SECONDARY']).default('SECONDARY'),
});

export const transferPrimarySchema = z.object({
  newPrimaryEmployeeId: z.string().min(1),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type AssignOwnerInput = z.infer<typeof assignOwnerSchema>;
export type TransferPrimaryInput = z.infer<typeof transferPrimarySchema>;
