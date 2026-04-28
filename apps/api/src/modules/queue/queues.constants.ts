// Queue names — V2 stripped POST_PUBLISHER (Post entity không còn).
export const QUEUE_NAMES = {
  ANALYTICS_SYNC: 'analytics-sync',
  ALERT_CHECKER: 'alert-checker',
  NOTIFICATION_SENDER: 'notification-sender',
} as const;

export const ALL_QUEUE_NAMES = Object.values(QUEUE_NAMES);

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const WORKER_OPTIONS = {
  [QUEUE_NAMES.ANALYTICS_SYNC]: {
    concurrency: 5,
    limiter: { max: 10, duration: 60_000 },
  },
  [QUEUE_NAMES.ALERT_CHECKER]: {
    concurrency: 3,
    limiter: undefined,
  },
  [QUEUE_NAMES.NOTIFICATION_SENDER]: {
    concurrency: 10,
    limiter: { max: 100, duration: 60_000 },
  },
} as const;

export const JOB_TIMEOUT_MS = {
  [QUEUE_NAMES.ANALYTICS_SYNC]: 60_000,
  [QUEUE_NAMES.ALERT_CHECKER]: 30_000,
  [QUEUE_NAMES.NOTIFICATION_SENDER]: 15_000,
} as const;
