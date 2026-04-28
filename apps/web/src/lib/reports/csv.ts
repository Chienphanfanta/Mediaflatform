// CSV renderer per report type. V2 stripped: CONTENT type bỏ; CHANNEL không còn postCount;
// HR không còn task/post fields.
import type { ReportData } from '@/lib/types/reports';

const BOM = '﻿';

function escape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRows(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => escape(r[h])).join(','));
  return [headers.join(','), ...body].join('\n');
}

export function reportToCsv(data: ReportData): string {
  const meta = [
    `Report Type,${data.type}`,
    `Period,${data.period.from} → ${data.period.to} (${data.period.label})`,
    `Generated At,${data.generatedAt}`,
    '',
  ].join('\n');

  if (data.type === 'CHANNEL') {
    const rows = data.channels.map((c) => ({
      channelId: c.id,
      name: c.name,
      platform: c.platform,
      status: c.status,
      views: c.views,
      watchTimeHours: c.watchTimeHours,
      subscribersGained: c.subscribersGained,
      revenue: c.revenue,
      avgEngagement: c.avgEngagement,
      viewsDeltaPct: c.viewsDeltaPct ?? '',
    }));
    return BOM + meta + '\n' + toRows(rows) + '\n';
  }

  // HR
  const rows = data.members.map((m) => ({
    userId: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    groups: m.groups.join(' | '),
  }));
  return BOM + meta + '\n' + toRows(rows) + '\n';
}
