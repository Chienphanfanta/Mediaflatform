// Zod schemas cho Group endpoints.
// TODO: chuyển sang packages/shared/src/schemas/ khi api backend (NestJS) cần dùng chung.
import { z } from 'zod';

export const GROUP_TYPES = ['HR', 'CONTENT', 'ANALYTICS', 'SYSTEM'] as const;
export const MEMBER_ROLES = ['ADMIN', 'MANAGER', 'STAFF', 'VIEWER'] as const;

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, 'Tên không được rỗng').max(100),
  type: z.enum(GROUP_TYPES),
  description: z.string().trim().max(500).optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    // Intentionally KHÔNG cho đổi `type` — tránh biến group thường thành SYSTEM (bypass RBAC)
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Phải có ít nhất 1 field để cập nhật' });
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const addMemberSchema = z.object({
  userId: z.string().min(1, 'userId bắt buộc'),
  role: z.enum(MEMBER_ROLES).default('STAFF'),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function parsePagination(url: URL): PaginationQuery {
  return paginationQuerySchema.parse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  });
}
