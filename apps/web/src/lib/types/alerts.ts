// Types cho alerts API — match shape trả về từ /api/v1/alerts/*
import type {
  AlertSeverity,
  AlertType,
  Platform,
} from '@prisma/client';

export type AlertItem = {
  id: string;
  channelId: string;
  type: AlertType;
  message: string;
  severity: AlertSeverity;
  isRead: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
  channel: {
    id: string;
    name: string;
    platform: Platform;
  };
};

export type AlertsListResponse = {
  items: AlertItem[];
  unreadCount: number;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};
