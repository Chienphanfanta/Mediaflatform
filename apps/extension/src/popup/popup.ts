// Popup: ghép trình duyệt bằng mã 6 ký tự + xem trạng thái tự đăng.
import { normalizeServerUrl, pairDevice } from '../shared/api';
import { getLocal, setLocal } from '../shared/storage';
import type { PopupState, RuntimeMessage } from '../shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const PLATFORM_LABEL: Record<string, string> = {
  YOUTUBE: 'YouTube',
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
};

function detectBrowser(): 'COCCOC' | 'CHROME' | 'OTHER' {
  const ua = navigator.userAgent;
  if (/coc_coc_browser/i.test(ua)) return 'COCCOC';
  if (/Chrome\//.test(ua)) return 'CHROME';
  return 'OTHER';
}

function detectOs(): string {
  const ua = navigator.userAgent;
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Không rõ';
}

function send<T>(msg: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  return new Date(ts).toLocaleString('vi-VN');
}

async function render(): Promise<void> {
  const st = await send<PopupState>({ type: 'GET_STATE' });
  $('version').textContent = `v${st.version}`;
  $('pair-view').hidden = st.paired;
  $('status-view').hidden = !st.paired;

  if (!st.paired) {
    const browser = detectBrowser();
    ($('server-url') as HTMLInputElement).value ||= st.serverUrl ?? '';
    ($('device-name') as HTMLInputElement).value ||=
      `Máy ${detectOs()} - ${browser === 'COCCOC' ? 'Cốc Cốc' : 'Chrome'}`;
    if (st.lastError) showPairError(st.lastError);
    return;
  }

  $('user-name').textContent = st.me?.user?.name ?? '—';
  $('device-name-label').textContent = st.me ? `${st.me.device.name} · ${st.me.user?.email ?? ''}` : '';
  $('pending-count').textContent = String(st.me?.pendingCount ?? 0);
  ($('paused') as HTMLInputElement).checked = st.paused;

  const job = $('current-job');
  job.hidden = !st.currentJob;
  if (st.currentJob) {
    job.textContent = `Đang đăng ${PLATFORM_LABEL[st.currentJob.platform]} · ${st.currentJob.channelName} — ${st.currentJob.step}`;
  }

  const err = $('last-error');
  err.hidden = !st.lastError;
  err.textContent = st.lastError ?? '';

  const channels = $('channels');
  channels.replaceChildren(
    ...(st.me?.channels.length
      ? st.me.channels.map((c) => {
          const li = el('li');
          li.append(el('span', `dot ${c.platform}`), el('span', '', `${c.name} (${PLATFORM_LABEL[c.platform]})`));
          return li;
        })
      : [el('li', 'muted', 'Chưa phụ trách kênh nào')]),
  );

  const log = $('log');
  log.replaceChildren(
    ...(st.log.length
      ? st.log.slice(0, 10).map((l) => {
          const li = el('li');
          li.append(
            el('span', l.ok ? 'ok' : 'fail', l.ok ? '✔' : '✖'),
            el('span', '', `${l.channelName}: ${l.message} · ${timeAgo(l.at)}`),
          );
          if (l.externalUrl) {
            const a = el('a', '', 'xem') as HTMLAnchorElement;
            a.href = l.externalUrl;
            a.target = '_blank';
            li.append(a);
          }
          return li;
        })
      : [el('li', 'muted', 'Chưa có')]),
  );
}

function showPairError(msg: string | null) {
  const e = $('pair-error');
  e.hidden = !msg;
  e.textContent = msg ?? '';
}

async function onPair(): Promise<void> {
  showPairError(null);
  const btn = $('pair-btn') as HTMLButtonElement;
  let serverUrl: string;
  try {
    serverUrl = normalizeServerUrl(($('server-url') as HTMLInputElement).value);
  } catch {
    showPairError('Địa chỉ hệ thống không hợp lệ (vd https://abc.tracker.com)');
    return;
  }
  const code = ($('pair-code') as HTMLInputElement).value.trim().toUpperCase();
  const name = ($('device-name') as HTMLInputElement).value.trim();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    showPairError('Mã ghép gồm 6 ký tự');
    return;
  }

  // Xin quyền gọi server (cần thao tác người dùng — đang trong click handler)
  const granted = await chrome.permissions.request({ origins: [`${serverUrl}/*`] });
  if (!granted) {
    showPairError('Cần cấp quyền truy cập địa chỉ hệ thống để extension hoạt động');
    return;
  }

  btn.disabled = true;
  try {
    const res = await pairDevice(serverUrl, { code, name: name || 'Trình duyệt', browser: detectBrowser(), os: detectOs() });
    await setLocal({ serverUrl, deviceToken: res.token, lastError: null, paused: false });
    await send({ type: 'TICK_NOW' });
    await render();
  } catch (e) {
    showPairError((e as Error).message);
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('pair-btn').addEventListener('click', () => void onPair());
  $('paused').addEventListener('change', async (e) => {
    await setLocal({ paused: (e.target as HTMLInputElement).checked });
  });
  $('tick-btn').addEventListener('click', async () => {
    ($('tick-btn') as HTMLButtonElement).disabled = true;
    await send({ type: 'TICK_NOW' });
    await render();
    ($('tick-btn') as HTMLButtonElement).disabled = false;
  });
  $('open-web-btn').addEventListener('click', async () => {
    const { serverUrl } = await getLocal(['serverUrl']);
    if (serverUrl) await chrome.tabs.create({ url: `${serverUrl}/posts` });
  });
  $('unpair-btn').addEventListener('click', async () => {
    if (!confirm('Ngắt kết nối trình duyệt này? Extension sẽ ngừng tự đăng bài.')) return;
    await send({ type: 'UNPAIR' });
    await render();
  });
  void render();
  setInterval(() => void render(), 3000);
});
