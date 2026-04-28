// HR aggregation helpers — V2 STUB.
//
// V1 logic (post/task aggregate) bỏ vì Post + Task entities không còn V2.
// Sprint 5/6 sẽ thay bằng `lib/kpi-calculation.ts` đọc từ KPI + ChannelMetric models.
//
// File này giữ shape compatible để callers không vỡ — return zero/empty.
import 'server-only';

export type UserMetricsRow = {
  userId: string;
  /** V2 sẽ tính từ KPI assignment + ChannelMetric — hiện stub về 0. */
  kpiAchievement: number;
};

/** STUB — Sprint 5/6 thay bằng query KPI table + aggregate ChannelMetric. */
export async function computeBatchMetrics(
  userIds: string[],
  _from: Date,
  _to: Date,
): Promise<Map<string, UserMetricsRow>> {
  const map = new Map<string, UserMetricsRow>();
  for (const id of userIds) {
    map.set(id, { userId: id, kpiAchievement: 0 });
  }
  return map;
}

export function computeKPI(_m: UserMetricsRow): number {
  return 0;
}

export function completionRate(_m: UserMetricsRow): number {
  return 0;
}

export function pickHighestRole(
  groupMembers: Array<{ role: string }>,
): string {
  const ROLE_RANK: Record<string, number> = {
    ADMIN: 4,
    MANAGER: 3,
    STAFF: 2,
    VIEWER: 1,
  };
  return (
    groupMembers.reduce<{ role: string; rank: number } | null>((best, mb) => {
      const rank = ROLE_RANK[mb.role] ?? 0;
      return !best || rank > best.rank ? { role: mb.role, rank } : best;
    }, null)?.role ?? '—'
  );
}

export function defaultRange(days = 30): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}
