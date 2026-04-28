// HTTP client cho Meta Graph API (Facebook + Instagram).
// Wrap fetch + parse error structure đặc thù Meta:
//   {"error":{"message":"...","type":"OAuthException","code":190,"error_subcode":460}}
//
// Error codes thường gặp (xem .claude/skills/platform-integrations.md §2-3):
//   190    → TokenExpiredError (invalid/expired token)
//   4      → RateLimitedError (app-level)
//   17     → RateLimitedError (user-level)
//   100    → MetaInvalidParamError (sai param, không retry)
//   200    → permission denied
//   368    → tạm khoá block (spam)
//   2      → temporary server error (có thể retry)
import { Injectable, Logger } from '@nestjs/common';

export class MetaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | string,
    public readonly subcode: number | undefined,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

export class MetaTokenExpiredError extends MetaApiError {
  constructor(subcode?: number, message = 'Meta token đã expired hoặc bị revoke') {
    super(401, 190, subcode, message);
    this.name = 'MetaTokenExpiredError';
  }
}

export class MetaRateLimitedError extends MetaApiError {
  constructor(
    public readonly scope: 'app' | 'user',
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(429, scope === 'app' ? 4 : 17, undefined, message);
    this.name = 'MetaRateLimitedError';
  }
}

export class MetaInvalidParamError extends MetaApiError {
  constructor(message: string) {
    super(400, 100, undefined, message);
    this.name = 'MetaInvalidParamError';
  }
}

type MetaRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
};

@Injectable()
export class MetaApiClient {
  private readonly logger = new Logger(MetaApiClient.name);

  /**
   * Gọi Meta Graph endpoint với Bearer token. Throw typed error theo `error.code`.
   * Caller dùng try/catch để retry hoặc mark TOKEN_EXPIRED.
   */
  async request<T = unknown>(
    url: string,
    init: MetaRequestInit,
    accessToken: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    };
    if (init.body && typeof init.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
    });

    // Track Meta's app-usage header để tự throttle (xem skill platform-integrations §2)
    const usage = res.headers.get('x-app-usage');
    if (usage) {
      try {
        const parsed = JSON.parse(usage) as {
          call_count?: number;
          total_cputime?: number;
          total_time?: number;
        };
        if ((parsed.call_count ?? 0) > 90) {
          this.logger.warn(`Meta app-usage cao: ${usage}`);
        }
      } catch {
        /* ignore */
      }
    }

    if (res.status === 204) return undefined as T;

    const data = await this.safeJson(res);

    if (!res.ok) {
      const err = (data as Record<string, any>)?.error ?? {};
      const code = Number(err.code ?? res.status);
      const subcode = err.error_subcode ? Number(err.error_subcode) : undefined;
      const msg = String(err.message ?? `HTTP ${res.status}`);

      if (code === 190) throw new MetaTokenExpiredError(subcode, msg);
      if (code === 4) {
        throw new MetaRateLimitedError(
          'app',
          `App rate limit: ${msg}`,
          this.parseRetryAfter(res),
        );
      }
      if (code === 17) {
        throw new MetaRateLimitedError(
          'user',
          `User rate limit: ${msg}`,
          this.parseRetryAfter(res),
        );
      }
      if (code === 100) throw new MetaInvalidParamError(msg);
      throw new MetaApiError(res.status, code, subcode, msg, data);
    }

    return data as T;
  }

  private parseRetryAfter(res: Response): number | undefined {
    const v = res.headers.get('Retry-After');
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  private async safeJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
}

// Endpoints constants
export const META = {
  VERSION: 'v18.0',
  GRAPH: 'https://graph.facebook.com/v18.0',
  TOKEN: 'https://graph.facebook.com/v18.0/oauth/access_token',
} as const;
