// GET /api/v1/ext/flows — kịch bản tự đăng (selector/nhãn) cho extension.
//
// Mặc định lấy DEFAULT_EXTENSION_FLOWS (packages/shared). Khi nền tảng đổi giao diện
// có thể sửa nóng KHÔNG cần deploy: đặt EXTENSION_FLOWS_OVERRIDE = JSON
// { flows: { FACEBOOK: {...} }, minGapBetweenPostsMs?: number } — flow nào có trong
// override sẽ thay thế hoàn toàn flow mặc định của nền tảng đó.
import { DEFAULT_EXTENSION_FLOWS, type ExtensionFlowsConfig } from '@media-ops/shared';

import { ok } from '@/lib/api-response';
import { withDevice } from '@/lib/posts/device-auth';

function loadFlows(): ExtensionFlowsConfig {
  const raw = process.env.EXTENSION_FLOWS_OVERRIDE;
  if (!raw) return DEFAULT_EXTENSION_FLOWS;
  try {
    const o = JSON.parse(raw) as Partial<ExtensionFlowsConfig>;
    return {
      version: o.version ?? DEFAULT_EXTENSION_FLOWS.version,
      minGapBetweenPostsMs:
        o.minGapBetweenPostsMs ?? DEFAULT_EXTENSION_FLOWS.minGapBetweenPostsMs,
      flows: { ...DEFAULT_EXTENSION_FLOWS.flows, ...(o.flows ?? {}) },
    };
  } catch (e) {
    console.error('[ext/flows] EXTENSION_FLOWS_OVERRIDE không phải JSON hợp lệ', e);
    return DEFAULT_EXTENSION_FLOWS;
  }
}

export const GET = withDevice(async () => ok(loadFlows()));
