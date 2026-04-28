// Types cho dashboard overview — dùng chung giữa API route và UI.
// V2: bỏ TopPost, ScheduledPost, DueTask (Post + Task entity không còn).
// Sprint 5/6 sẽ thêm KPI achievement types.

import type { Platform, ChannelStatus } from '@prisma/client';

export type DeltaMetric = {
  value: number;
  deltaPct: number | null; // null khi không có hôm qua để so sánh
  vsValue: number;
};

export type ViewsByDay = {
  date: string; // YYYY-MM-DD
  YOUTUBE: number;
  FACEBOOK: number;
  INSTAGRAM: number;
  TELEGRAM: number;
  WHATSAPP: number;
  // V1 X removed
};

export type ChannelHealthItem = {
  id: string;
  name: string;
  platform: Platform;
  status: ChannelStatus;
  viewsToday: number;
  health: 'green' | 'yellow' | 'red';
};

export type DashboardOverview = {
  metrics: {
    viewsToday: DeltaMetric;
    watchTimeHoursToday: DeltaMetric;
    // V2 thay postsToday/pendingTasks bằng KPI overview Sprint 6
  };
  viewsByDay: ViewsByDay[];
  channels: ChannelHealthItem[];
};
