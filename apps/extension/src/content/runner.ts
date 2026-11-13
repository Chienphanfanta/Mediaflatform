// Content runner — được background inject vào tab trang đăng bài, chạy kịch bản (flow)
// gồm các bước khai báo: wait / click / upload / type / waitText / waitUrl / ...
//
// Kỹ thuật thao tác editor:
//   - <input>/<textarea> (React): gán qua native value setter + bắn sự kiện input
//   - contenteditable (Lexical của Facebook, DraftJS của TikTok, YouTube): focus →
//     execCommand('insertText'); nếu editor không nhận thì giả lập paste
//   - File: tải từ MinIO (presigned URL) → File → gán vào <input type=file> qua DataTransfer
import type { FlowStep, FlowTarget, FlowValue, FlowWhen } from '@media-ops/shared';

import type { FlowResult, RunFlowJob, RuntimeMessage } from '../shared/types';

declare global {
  interface Window {
    __mediaOpsRunnerLoaded?: boolean;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_MS = 500;
const KEEPALIVE_MS = 20_000;
const DEFAULT_BUTTON_SCOPE = 'button, [role="button"], a, tp-yt-paper-button, ytcp-button';

class StepError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

if (!window.__mediaOpsRunnerLoaded) {
  window.__mediaOpsRunnerLoaded = true;
  chrome.runtime.onMessage.addListener((msg: { type: string; job?: RunFlowJob }) => {
    if (msg.type === 'RUN_FLOW' && msg.job) void run(msg.job);
    return false;
  });
}

function send(msg: RuntimeMessage) {
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

async function run(job: RunFlowJob): Promise<void> {
  const { targetId, flow, item } = job;
  let currentStep = 'Bắt đầu';
  const keepalive = setInterval(
    () => send({ type: 'FLOW_PROGRESS', targetId, step: currentStep }),
    KEEPALIVE_MS,
  );
  const ctx = new RunContext(job);
  let result: FlowResult;

  try {
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      if (step.when && !ctx.matches(step.when)) continue;
      currentStep = step.label;
      send({ type: 'FLOW_PROGRESS', targetId, step: step.label });

      // "Chờ URL": trang sắp chuyển → runner sẽ bị huỷ. Giao cho background theo dõi
      // (tabs.onUpdated) rồi dừng. Các bước sau waitUrl chỉ được phép là sleep.
      if (step.do === 'waitUrl') {
        const rest = flow.steps.slice(i + 1);
        clearInterval(keepalive);
        send({
          type: 'FLOW_AWAIT_URL',
          targetId,
          includes: step.includes,
          timeoutMs: step.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          optional: !!step.optional,
          extraDelayMs: rest.reduce((sum, s) => sum + (s.do === 'sleep' ? s.ms : 0), 0),
          externalUrl: ctx.capturedUrl ?? flow.fallbackUrl ?? item.channel.externalUrl,
        });
        return;
      }

      try {
        await ctx.exec(step);
      } catch (e) {
        if (step.optional) continue;
        throw e;
      }
    }
    result = { ok: true, externalUrl: ctx.capturedUrl ?? flow.fallbackUrl ?? item.channel.externalUrl };
  } catch (e) {
    const retryable = e instanceof StepError ? e.retryable : true;
    result = {
      ok: false,
      error: `[${flow.platform} v${flow.version}] Bước "${currentStep}": ${(e as Error).message}`,
      retryable,
    };
  } finally {
    clearInterval(keepalive);
  }
  send({ type: 'FLOW_DONE', targetId, result });
}

class RunContext {
  capturedUrl: string | null = null;
  private files: File[] | null = null;

  constructor(private readonly job: RunFlowJob) {}

  matches(when: FlowWhen): boolean {
    const media = this.job.item.media;
    switch (when) {
      case 'hasMedia':
        return media.length > 0;
      case 'noMedia':
        return media.length === 0;
      case 'hasVideo':
        return media.some((m) => m.type === 'VIDEO');
      case 'hasImages':
        return media.some((m) => m.type === 'IMAGE');
      case 'hasTitle':
        return !!this.job.item.post.title;
    }
  }

  value(v: FlowValue): string {
    const { post } = this.job.item;
    if (v === 'title') return (post.title ?? post.caption.split('\n')[0]).slice(0, 100);
    if (v === 'caption') return post.caption;
    const tags = post.hashtags.join(' ');
    return tags ? `${post.caption}\n\n${tags}` : post.caption;
  }

  async exec(step: FlowStep): Promise<void> {
    const timeout = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    switch (step.do) {
      case 'sleep':
        await sleep(step.ms);
        return;
      case 'wait':
        await waitFor(step.target, timeout);
        return;
      case 'click': {
        const el = await waitFor(step.target, timeout, step.waitEnabled ? isEnabled : undefined);
        clickElement(el);
        return;
      }
      case 'upload': {
        const input = await waitFor(step.target, timeout, undefined, true);
        if (!(input instanceof HTMLInputElement) || input.type !== 'file') {
          throw new StepError('Phần tử tìm được không phải ô chọn file', false);
        }
        const files = await this.loadFiles();
        const dt = new DataTransfer();
        for (const f of input.multiple ? files : files.slice(0, 1)) dt.items.add(f);
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      case 'type': {
        const el = await waitFor(step.target, timeout);
        await typeInto(el, this.value(step.value), !!step.clear);
        return;
      }
      case 'waitText': {
        const needles = step.anyOf.map(norm);
        await poll(timeout, () => {
          const els = findAll(step.target);
          return els.some((el) => needles.some((n) => norm(el.textContent ?? '').includes(n)))
            ? true
            : null;
        }, `Không thấy trạng thái mong đợi (${step.anyOf.slice(0, 3).join(' / ')}...)`);
        return;
      }
      case 'waitUrl':
        return; // xử lý ở run() — giao cho background
      case 'captureUrl': {
        const el = await waitFor(step.target, timeout);
        const raw = step.attr ? el.getAttribute(step.attr) : el.textContent;
        const url = raw?.trim();
        if (url && /^https?:\/\//.test(url)) this.capturedUrl = url;
        return;
      }
      case 'choosePrivacy': {
        const privacy = this.job.item.options?.privacy ?? 'public';
        const target = step.map[privacy];
        if (!target) return; // nền tảng không có lựa chọn này → giữ mặc định
        clickElement(await waitFor(target, timeout));
        return;
      }
    }
  }

  private async loadFiles(): Promise<File[]> {
    if (this.files) return this.files;
    const media = this.job.item.media;
    if (media.length === 0) throw new StepError('Bài không có file để upload', false);
    this.files = await Promise.all(
      media.map(async (m) => {
        let res: Response;
        try {
          res = await fetch(m.url);
        } catch {
          throw new StepError(
            `Không tải được file "${m.fileName}" từ kho lưu trữ (kiểm tra S3_PUBLIC_ENDPOINT / CORS MinIO)`,
            true,
          );
        }
        if (!res.ok) throw new StepError(`Tải file "${m.fileName}" lỗi HTTP ${res.status}`, true);
        const blob = await res.blob();
        return new File([blob], m.fileName, { type: m.mimeType, lastModified: Date.now() });
      }),
    );
    return this.files;
  }
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  if (el.getClientRects().length === 0) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none';
}

function isEnabled(el: Element): boolean {
  return !(
    (el as HTMLButtonElement).disabled ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.hasAttribute('disabled')
  );
}

function findAll(target: FlowTarget, includeHidden = false): Element[] {
  const out: Element[] = [];
  for (const sel of target.css ?? []) {
    try {
      document.querySelectorAll(sel).forEach((el) => out.push(el));
    } catch {
      /* selector sai cú pháp → bỏ qua */
    }
  }
  if (target.text?.length) {
    const wanted = target.text.map(norm);
    document.querySelectorAll(target.textScope ?? DEFAULT_BUTTON_SCOPE).forEach((el) => {
      const label = norm((el as HTMLElement).innerText ?? el.textContent ?? '');
      const aria = norm(el.getAttribute('aria-label') ?? '');
      if (wanted.includes(label) || wanted.includes(aria)) out.push(el);
    });
  }
  // File input thường bị ẩn → cho phép lấy phần tử ẩn
  return includeHidden ? out : out.filter(isVisible);
}

async function waitFor(
  target: FlowTarget,
  timeoutMs: number,
  extra?: (el: Element) => boolean,
  includeHidden = false,
): Promise<Element> {
  return poll(
    timeoutMs,
    () => findAll(target, includeHidden).find((el) => (extra ? extra(el) : true)) ?? null,
    extra
      ? 'Không tìm thấy nút ở trạng thái bấm được (có thể upload chưa xong hoặc giao diện đã đổi)'
      : 'Không tìm thấy phần tử trên trang (giao diện có thể đã đổi)',
  );
}

async function poll<T>(timeoutMs: number, fn: () => T | null, errorMsg: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > deadline) throw new StepError(errorMsg, false);
    await sleep(POLL_MS);
  }
}

function clickElement(el: Element) {
  (el as HTMLElement).scrollIntoView?.({ block: 'center' });
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  (el as HTMLElement).click();
}

async function typeInto(el: Element, text: string, clear: boolean): Promise<void> {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    setter?.call(el, clear ? text : el.value + text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  const editable = el as HTMLElement;
  editable.focus();
  await sleep(150);
  if (clear) {
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    await sleep(100);
  }
  document.execCommand('insertText', false, text);
  await sleep(300);

  // Kiểm tra editor đã nhận chữ chưa; chưa thì giả lập paste
  const probe = norm(text.slice(0, 30));
  if (probe && !norm(editable.innerText ?? '').includes(probe)) {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    editable.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    await sleep(300);
    if (!norm(editable.innerText ?? '').includes(probe)) {
      throw new StepError('Không nhập được nội dung vào ô soạn thảo', false);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
