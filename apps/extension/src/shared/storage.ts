// Truy cập chrome.storage có kiểu.
//   local   — cấu hình bền (server, token, log, flows cache)
//   session — trạng thái job đang chạy (mất khi tắt trình duyệt)
import type { CurrentJob, ExtensionFlowsConfig, JobLogEntry, MeInfo } from './types';

type LocalData = {
  serverUrl: string;
  deviceToken: string;
  paused: boolean;
  me: MeInfo;
  lastError: string | null;
  log: JobLogEntry[];
  flows: ExtensionFlowsConfig;
  flowsFetchedAt: number;
  lastPostAt: number;
};

type SessionData = {
  currentJob: CurrentJob | null;
};

export async function getLocal<K extends keyof LocalData>(
  keys: K[],
): Promise<Partial<Pick<LocalData, K>>> {
  return (await chrome.storage.local.get(keys)) as Partial<Pick<LocalData, K>>;
}

export async function setLocal(data: Partial<LocalData>): Promise<void> {
  await chrome.storage.local.set(data);
}

export async function removeLocal(keys: Array<keyof LocalData>): Promise<void> {
  await chrome.storage.local.remove(keys);
}

export async function getCurrentJob(): Promise<CurrentJob | null> {
  const d = (await chrome.storage.session.get('currentJob')) as Partial<SessionData>;
  return d.currentJob ?? null;
}

export async function setCurrentJob(job: CurrentJob | null): Promise<void> {
  await chrome.storage.session.set({ currentJob: job });
}

const LOG_LIMIT = 30;

export async function appendLog(entry: JobLogEntry): Promise<void> {
  const { log = [] } = await getLocal(['log']);
  await setLocal({ log: [entry, ...log].slice(0, LOG_LIMIT) });
}
