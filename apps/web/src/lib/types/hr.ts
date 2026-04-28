// Shared types cho HR module — list + detail.
// Day 9: thêm phone, position, joinDate, department, channels (with role).
import type { MemberRole, OwnershipRole, Platform, UserStatus } from '@prisma/client';

export type HRUserGroup = {
  id: string;
  name: string;
  role: MemberRole;
};

export type HRUserDepartment = {
  id: string;
  name: string;
  color: string | null;
};

export type HRUserChannelOwnership = {
  id: string;
  name: string;
  platform: Platform;
  role: OwnershipRole;
};

export type HRUserListItem = {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  status: UserStatus;
  primaryRole: string;
  groups: HRUserGroup[];
  // Day 9 fields
  phone?: string | null;
  position?: string | null;
  joinDate?: string | null;
  // Optional — chỉ có khi ?expand=full
  department?: HRUserDepartment | null;
  channels?: HRUserChannelOwnership[];
  kpiAvgAchievement?: number | null;
};

export type HRUserDetail = {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  phone: string | null;
  position: string | null;
  joinDate: string | null;
  terminateDate: string | null;
  status: UserStatus;
  primaryRole: string;
  createdAt: string;
  groups: HRUserGroup[];
  department: HRUserDepartment | null;

  // Period info
  rangeFrom: string;
  rangeTo: string;
  rangeDays: number;

  // Channels nhân viên ownership trực tiếp (PRIMARY/SECONDARY)
  ownedChannels: HRUserChannelOwnership[];

  // Channels user có quyền truy cập (qua group membership)
  channels: Array<{
    id: string;
    name: string;
    platform: Platform;
  }>;
};
