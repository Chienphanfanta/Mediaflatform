// Service worker (MV3) — điều phối tự đăng bài.
//
// Mỗi phút (chrome.alarms):
//   1. Heartbeat GET /ext/me → cập nhật badge số bài chờ
//   2. Nếu đang rảnh + không tạm dừng + đủ khoảng nghỉ → GET /ext/queue
//   3. Claim target đầu tiên → mở cửa sổ trang đăng bài của nền tảng
//   4. Inject content/runner.js → chạy kịch bản (flow) → runner gửi FLOW_DONE
//   5. Báo kết quả lên server, đóng cửa sổ, ghi log
//
// Service worker có thể bị Chrome tắt bất cứ lúc nào → mọi trạng thái job lưu ở
// chrome.storage.session; runner gửi FLOW_PROGRESS mỗi ~20s để giữ worker sống.
import { DEFAULT_EXTENSION_FLOWS } from '@media-ops/shared';

import {
  ApiError,
  EXTENSION_VERSION,
  claimTarget,
  getFlows,
  getMe,
  getQueue,
  reportResult,
  unpairDevice,
} from '../shared/api';
import {
  appendLog,
  getCurrentJob,
  getLocal,
  removeLocal,
  setCurrentJob,
  setLocal,
} from '../shared/storage';
import type {
  ExtensionFlowsConfig,
  FlowResult,
  PopupState,
  QueueItem,
  RunFlowJob,
  RuntimeMessage,
} from '../shared/types';

const ALARM = 'media-ops-tick';
const FLOWS_TTL_MS = 10 * 60_000;
const TAB_LOAD_TIMEOUT_MS = 90_000;
/** Không có tiến trình quá lâu → coi như kẹt (video lớn vẫn gửi progress định kỳ) */
const JOB_STALL_MS = 10 * 60_000;
const JOB_MAX_MS = 75 * 60_000;

let ticking = false;

// ─── Lifecycle ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => void ensureAlarm());
chrome.runtime.onStartup.addListener(() => void ensureAlarm());

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 0.1 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void tick();
});

// ─── Messages từ popup / runner ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
  switch (msg.type) {
    case 'FLOW_PROGRESS':
      void onProgress(msg.targetId, msg.step);
      return false;
    case 'FLOW_DONE':
      void finishJob(msg.targetId, msg.result, sender.tab?.id);
      return false;
    case 'FLOW_AWAIT_URL':
      void startAwaitUrl(msg, sender.tab);
      return false;
    case 'TICK_NOW':
      void ensureAlarm().then(() => tick()).then(() => sendResponse(true));
      return true;
    case 'GET_STATE':
      void getPopupState().then(sendResponse);
      return true;
    case 'UNPAIR':
      void unpair().then(() => sendResponse(true));
      return true;
    default:
      return false;
  }
});

// Trang chuyển URL (kể cả pushState) → kiểm tra job đang "chờ URL"
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) void checkAwaitUrl(tabId, info.url);
});

async function startAwaitUrl(
  msg: Extract<RuntimeMessage, { type: 'FLOW_AWAIT_URL' }>,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  const job = await getCurrentJob();
  if (!job || job.targetId !== msg.targetId) return;
  await setCurrentJob({
    ...job,
    step: 'Chờ nền tảng xác nhận đã đăng',
    lastProgressAt: Date.now(),
    awaitUrl: {
      includes: msg.includes,
      deadline: Date.now() + msg.timeoutMs,
      optional: msg.optional,
      extraDelayMs: msg.extraDelayMs,
      externalUrl: msg.externalUrl,
    },
  });
  // URL có thể đã khớp sẵn trước khi message tới
  if (tab?.id !== undefined) {
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (current?.url) await checkAwaitUrl(tab.id, current.url);
  }
}

async function checkAwaitUrl(tabId: number, url: string): Promise<void> {
  const job = await getCurrentJob();
  if (!job?.awaitUrl || job.tabId !== tabId) return;
  if (!job.awaitUrl.includes.some((s) => url.includes(s))) return;
  const { externalUrl, extraDelayMs } = job.awaitUrl;
  await setCurrentJob({ ...job, awaitUrl: undefined, lastProgressAt: Date.now() });
  if (extraDelayMs > 0) await new Promise((r) => setTimeout(r, Math.min(extraDelayMs, 20_000)));
  await finishJob(job.targetId, { ok: true, externalUrl }, tabId);
}

// Người dùng tự đóng cửa sổ đăng bài giữa chừng
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const job = await getCurrentJob();
  if (job && job.tabId === tabId) {
    await finishJob(
      job.targetId,
      { ok: false, error: 'Cửa sổ đăng bài bị đóng giữa chừng', retryable: true },
      undefined,
      true,
    );
  }
});

// ─── Tick ────────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const { deviceToken, paused, lastPostAt = 0 } = await getLocal([
      'deviceToken',
      'paused',
      'lastPostAt',
    ]);
    if (!deviceToken) return;

    // 1. Heartbeat
    try {
      const me = await getMe();
      await setLocal({ me, lastError: null });
      await setBadge(me.pendingCount);
    } catch (e) {
      await handleApiError(e);
      return;
    }

    // 2. Job đang chạy → kiểm tra kẹt
    const job = await getCurrentJob();
    if (job?.awaitUrl && Date.now() > job.awaitUrl.deadline) {
      // Hết thời gian chờ URL: bước optional → coi như đã đăng (nút Đăng đã bấm)
      await finishJob(
        job.targetId,
        job.awaitUrl.optional
          ? { ok: true, externalUrl: job.awaitUrl.externalUrl }
          : { ok: false, error: 'Nền tảng không xác nhận đã đăng', retryable: false },
        job.tabId,
      );
      return;
    }
    if (job) {
      const now = Date.now();
      if (now - job.lastProgressAt > JOB_STALL_MS || now - job.startedAt > JOB_MAX_MS) {
        await finishJob(
          job.targetId,
          { ok: false, error: `Quá thời gian ở bước "${job.step}"`, retryable: true },
          job.tabId,
        );
      }
      return;
    }
    if (paused) return;

    const flows = await loadFlows();
    if (Date.now() - lastPostAt < flows.minGapBetweenPostsMs) return;

    // 3. Lấy hàng chờ + claim
    const { items } = await getQueue();
    for (const item of items) {
      if (!flows.flows[item.platform]) continue;
      try {
        await claimTarget(item.targetId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) continue; // máy khác đã nhận
        throw e;
      }
      await startJob(item, flows);
      return;
    }
  } catch (e) {
    await setLocal({ lastError: (e as Error).message });
  } finally {
    ticking = false;
  }
}

async function loadFlows(): Promise<ExtensionFlowsConfig> {
  const { flows, flowsFetchedAt = 0 } = await getLocal(['flows', 'flowsFetchedAt']);
  if (flows && Date.now() - flowsFetchedAt < FLOWS_TTL_MS) return flows;
  try {
    const fresh = await getFlows();
    await setLocal({ flows: fresh, flowsFetchedAt: Date.now() });
    return fresh;
  } catch {
    return flows ?? DEFAULT_EXTENSION_FLOWS;
  }
}

// ─── Job ─────────────────────────────────────────────────────────────────────

function fillTemplate(tpl: string, item: QueueItem): string {
  const username = String(item.channel.metadata?.username ?? '').replace(/^@/, '');
  return tpl
    .replace(/\{accountId\}/g, encodeURIComponent(item.channel.accountId))
    .replace(/\{username\}/g, encodeURIComponent(username));
}

async function startJob(item: QueueItem, config: ExtensionFlowsConfig): Promise<void> {
  const flow = config.flows[item.platform];
  const url = fillTemplate(flow.openUrl, item);

  // Cửa sổ riêng, không chiếm focus của người dùng
  const win = await chrome.windows.create({ url, focused: false, type: 'normal' });
  const tabId = win.tabs?.[0]?.id;
  if (tabId === undefined) {
    await reportSafe(item.targetId, { ok: false, error: 'Không mở được cửa sổ đăng bài', retryable: true });
    return;
  }

  const now = Date.now();
  await setCurrentJob({
    targetId: item.targetId,
    channelName: item.channel.name,
    platform: item.platform,
    tabId,
    windowId: win.id,
    startedAt: now,
    lastProgressAt: now,
    step: 'Mở trang đăng bài',
  });

  try {
    await waitTabComplete(tabId);
    const tab = await chrome.tabs.get(tabId);
    const loginProblem = detectLoginPage(tab.url ?? '');
    if (loginProblem) {
      await finishJob(item.targetId, { ok: false, error: loginProblem, retryable: false }, tabId);
      return;
    }

    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/runner.js'] });
    const job: RunFlowJob = {
      targetId: item.targetId,
      flow: { ...flow, fallbackUrl: flow.fallbackUrl ? fillTemplate(flow.fallbackUrl, item) : undefined },
      item,
    };
    await chrome.tabs.sendMessage(tabId, { type: 'RUN_FLOW', job });
  } catch (e) {
    await finishJob(
      item.targetId,
      { ok: false, error: `Không chạy được kịch bản: ${(e as Error).message}`, retryable: true },
      tabId,
    );
  }
}

function detectLoginPage(url: string): string | null {
  if (/accounts\.google\.com|ServiceLogin|signin/i.test(url)) {
    return 'Trình duyệt chưa đăng nhập Google/YouTube của kênh này';
  }
  if (/facebook\.com\/(login|checkpoint)/i.test(url)) {
    return 'Trình duyệt chưa đăng nhập Facebook (hoặc bị checkpoint)';
  }
  if (/tiktok\.com\/login/i.test(url)) {
    return 'Trình duyệt chưa đăng nhập TikTok';
  }
  return null;
}

function waitTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Trang tải quá lâu'));
    }, TAB_LOAD_TIMEOUT_MS);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') listener(tabId, { status: 'complete' });
    }, reject);
  });
}

async function onProgress(targetId: string, step: string): Promise<void> {
  const job = await getCurrentJob();
  if (job?.targetId === targetId) {
    await setCurrentJob({ ...job, step, lastProgressAt: Date.now() });
  }
}

async function finishJob(
  targetId: string,
  result: FlowResult,
  tabId: number | undefined,
  tabAlreadyClosed = false,
): Promise<void> {
  const job = await getCurrentJob();
  if (!job || job.targetId !== targetId) return; // đã xử lý rồi
  await setCurrentJob(null);

  await reportSafe(targetId, result);
  await appendLog({
    at: Date.now(),
    targetId,
    channelName: job.channelName,
    platform: job.platform,
    ok: result.ok,
    message: result.ok ? 'Đăng thành công' : result.error,
    externalUrl: result.ok ? result.externalUrl : null,
  });
  await setLocal({ lastPostAt: Date.now() });

  if (!result.ok) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `Đăng lỗi: ${job.channelName}`,
      message: result.error.slice(0, 200),
    });
  }

  const closeTab = tabId ?? job.tabId;
  if (!tabAlreadyClosed && closeTab !== undefined) {
    // Giữ tab lỗi lại 1 chút để người dùng nhìn thấy? → đóng luôn, lỗi đã có trong log
    await chrome.tabs.remove(closeTab).catch(() => undefined);
  }
}

async function reportSafe(targetId: string, result: FlowResult): Promise<void> {
  try {
    await reportResult(
      targetId,
      result.ok
        ? { success: true, externalUrl: result.externalUrl }
        : { success: false, error: result.error.slice(0, 2000), retryable: result.retryable },
    );
  } catch (e) {
    await setLocal({ lastError: `Không báo được kết quả: ${(e as Error).message}` });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function handleApiError(e: unknown): Promise<void> {
  const err = e as ApiError;
  if (err.code === 'DEVICE_REVOKED' || err.code === 'USER_INACTIVE') {
    await removeLocal(['deviceToken', 'me']);
    await setBadge(null);
  }
  await setLocal({ lastError: err.message });
}

async function setBadge(count: number | null): Promise<void> {
  await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 99)) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
}

async function unpair(): Promise<void> {
  // Báo server thu hồi token (bỏ qua lỗi mạng — vẫn xoá token cục bộ)
  await unpairDevice().catch(() => undefined);
  const job = await getCurrentJob();
  if (job) await chrome.tabs.remove(job.tabId).catch(() => undefined);
  await removeLocal(['deviceToken', 'me', 'lastError', 'flows', 'flowsFetchedAt']);
  await setCurrentJob(null);
  await setBadge(null);
}

async function getPopupState(): Promise<PopupState> {
  const d = await getLocal(['serverUrl', 'deviceToken', 'paused', 'me', 'lastError', 'log']);
  return {
    serverUrl: d.serverUrl ?? null,
    paired: !!d.deviceToken,
    paused: !!d.paused,
    me: d.me ?? null,
    lastError: d.lastError ?? null,
    currentJob: await getCurrentJob(),
    log: d.log ?? [],
    version: EXTENSION_VERSION,
  };
}
