// Zod schemas cho /api/v1/users CRUD + /api/v1/departments CRUD.
import { z } from 'zod';

// ───── User / Employee ─────

export const createEmployeeSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(100),
  phone: z.string().max(40).optional().nullable(),
  position: z.string().max(120).optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  departmentId: z.string().min(1).optional().nullable(),
  joinDate: z.coerce.date().optional().nullable(),
  /** Group memberships để tạo cùng — mỗi entry { groupId, role } */
  groupMemberships: z
    .array(
      z.object({
        groupId: z.string().min(1),
        role: z.enum(['ADMIN', 'MANAGER', 'STAFF', 'VIEWER']),
      }),
    )
    .max(10)
    .optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().nullable(),
  position: z.string().max(120).optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  departmentId: z.string().min(1).optional().nullable(),
  joinDate: z.coerce.date().optional().nullable(),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const transferChannelsSchema = z.object({
  toEmployeeId: z.string().min(1),
});
export type TransferChannelsInput = z.infer<typeof transferChannelsSchema>;

// ───── Department ─────

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/i, 'Color phải là hex format vd #3b82f6')
    .optional()
    .nullable(),
  managerId: z.string().min(1).optional().nullable(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/i)
    .optional()
    .nullable(),
  managerId: z.string().min(1).optional().nullable(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
