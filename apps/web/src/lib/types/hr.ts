// Shared types cho HR module — list + detail.
// V2: bỏ Post + Task fields. Sprint 6 thêm KPI assignments + ChannelOwnership.
import type { MemberRole, Platform, UserStatus } from '@prisma/client';

export type HRUserGroup = {
  id: string;
  name: string;
  role: MemberRole;
};

export type HRUserListItem = {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  status: UserStatus;
  primaryRole: string; // highest role across groups
  groups: HRUserGroup[];
  // V1 stripped: postsAuthored, postsPublished, tasksAssigned, tasksDone, kpi
};

export type HRUserDetail = {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  status: UserStatus;
  primaryRole: string;
  createdAt: string;
  groups: HRUserGroup[];

  // Period info
  rangeFrom: string;
  rangeTo: string;
  rangeDays: number;

  // Channels user có quyền truy cập (qua group membership)
  channels: Array<{
    id: string;
    name: string;
    platform: Platform;
  }>;

  // V1 stripped: metrics, recentPosts, openTasks. Sprint 6 thêm KPI assignments.
};
