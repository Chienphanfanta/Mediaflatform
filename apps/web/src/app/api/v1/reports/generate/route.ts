// POST /api/v1/reports/generate — gate MANAGER+. Body: GenerateReportInput.
// Trả về JSON / CSV (text/csv) / PDF (application/pdf) tuỳ format.
import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/with-auth';
import { fail, ok } from '@/lib/api-response';
import { meetsRole } from '@/lib/rbac';
import { generateReportSchema } from '@/lib/schemas/reports';
import { generateReport } from '@/lib/reports/generate';
import { reportToCsv } from '@/lib/reports/csv';

export const POST = withAuth(
  async ({ req, user }) => {
    if (!meetsRole(user, 'MANAGER')) {
      return fail('FORBIDDEN', 'Tạo báo cáo yêu cầu quyền Manager trở lên', {
        status: 403,
      });
    }

    const body = await req.json();
    const parsed = generateReportSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', {
        status: 422,
        details: parsed.error.issues,
      });
    }

    let data;
    try {
      data = await generateReport(parsed.data, user);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'FORBIDDEN_GROUP') {
        return fail('FORBIDDEN', 'Bạn không thuộc group này', { status: 403 });
      }
      if (msg === 'CHANNEL_OUT_OF_SCOPE') {
        return fail('FORBIDDEN', 'Một số channelIds không trong scope của bạn', {
          status: 403,
        });
      }
      throw e; // withAuth catch unknown
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `report-${parsed.data.type.toLowerCase()}-${stamp}`;

    if (parsed.data.format === 'JSON') {
      return ok(data);
    }

    if (parsed.data.format === 'CSV') {
      const csv = reportToCsv(data);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // PDF — dynamic import để tránh bundle nặng vào build chính
    const { reportToPdfBuffer } = await import('@/lib/reports/pdf');
    const buffer = await reportToPdfBuffer(data);
    // Buffer → Uint8Array (copy) → Blob. Tránh issue type SharedArrayBuffer của Node Buffer.
    const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });

    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${baseName}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  },
  { rateLimit: { limit: 10, windowMs: 60_000 } },
);
