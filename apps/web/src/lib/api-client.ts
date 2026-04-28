// Fetch helper — unwrap { success, data } → chỉ return data, throw nếu fail.
// Dùng chung cho React Query, server actions, hoặc component fetch ad-hoc.

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

type ApiEnvelope<T> =
  | { success: true; data: T; meta?: Record<string, unknown> }
  | { success: false; error: { code: string; message: string; details?: unknown } };

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | number | undefined> },
): Promise<T> {
  const url = new URL(path, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const json = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !json.success) {
    const err = !json.success
      ? json.error
      : { code: `HTTP_${res.status}`, message: res.statusText };
    throw new ApiClientError(err.code, err.message, res.status, (err as any).details);
  }
  return json.data;
}
