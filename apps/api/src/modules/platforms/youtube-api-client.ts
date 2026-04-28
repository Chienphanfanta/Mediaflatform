// HTTP client cho YouTube Data API v3 + Analytics API v2.
// Wraps fetch với typed errors để service layer handle:
//   - TokenExpiredError (401) → caller refresh + retry
//   - QuotaExceededError (403 reason=quotaExceeded) → block until reset
//   - RateLimitedError (429) → respect Retry-After
//   - VideoProcessingError (uploadStatus=processing) — handle riêng ở caller
import { Injectable, Logger } from '@nestjs/common';

export class YouTubeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}

export class TokenExpiredError extends YouTubeApiError {
  constructor(message = 'YouTube access token expired or invalid') {
    super(401, 'invalid_credentials', message);
    this.name = 'TokenExpiredError';
  }
}

export class QuotaExceededError extends YouTubeApiError {
  constructor(message = 'YouTube API quota exceeded') {
    super(403, 'quotaExceeded', message);
    this.name = 'QuotaExceededError';
  }
}

export class RateLimitedError extends YouTubeApiError {
  constructor(public readonly retryAfterSec: number) {
    super(429, 'rate_limited', `YouTube rate limited, retry sau ${retryAfterSec}s`);
    this.name = 'RateLimitedError';
  }
}

export class VideoProcessingError extends YouTubeApiError {
  constructor(public readonly videoId: string) {
    super(202, 'processing', `Video ${videoId} đang processing trên YouTube`);
    this.name = 'VideoProcessingError';
  }
}

// Local type — không dùng tên "RequestInit" để tránh shadow global lib type.
type YtRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | URLSearchParams;
  /** Đừng parse JSON — caller tự xử lý (vd lấy headers từ resumable upload). */
  rawResponse?: boolean;
};

@Injectable()
export class YouTubeApiClient {
  private readonly logger = new Logger(YouTubeApiClient.name);

  /**
   * Gọi API có Bearer token. Trả JSON đã parse, hoặc Response thô khi `rawResponse=true`.
   * Throw typed errors để service catch đúng case.
   */
  async request<T = unknown>(
    url: string,
    init: YtRequestInit & { rawResponse: true },
    accessToken: string,
  ): Promise<Response>;
  async request<T = unknown>(
    url: string,
    init: YtRequestInit,
    accessToken: string,
  ): Promise<T>;
  async request<T = unknown>(
    url: string,
    init: YtRequestInit,
    accessToken: string,
  ): Promise<T | Response> {
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

    if (init.rawResponse) {
      // Caller xử lý — nhưng vẫn check 401/403/429 để throw đúng error
      if (res.status === 401) throw new TokenExpiredError();
      if (res.status === 429) {
        throw new RateLimitedError(Number(res.headers.get('Retry-After') ?? 60));
      }
      return res;
    }

    if (res.status === 401) throw new TokenExpiredError();

    if (res.status === 429) {
      const retry = Number(res.headers.get('Retry-After') ?? 60);
      throw new RateLimitedError(retry);
    }

    if (res.status === 403) {
      const data = await this.safeJson(res);
      const reason = (data as Record<string, unknown>)?.error
        ? (((data as { error: { errors?: Array<{ reason?: string }> } }).error
            .errors?.[0]?.reason as string) ?? 'forbidden')
        : 'forbidden';
      if (reason === 'quotaExceeded') throw new QuotaExceededError();
      throw new YouTubeApiError(403, reason, `YouTube 403: ${reason}`, data);
    }

    if (!res.ok) {
      const data = await this.safeJson(res);
      const msg =
        (data as { error?: { message?: string } })?.error?.message ??
        `HTTP ${res.status}`;
      throw new YouTubeApiError(res.status, 'http_error', `YouTube ${msg}`, data);
    }

    // 204 No Content
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async safeJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
}

// Endpoints constants (tránh hardcode rải rác)
export const YT = {
  V3: 'https://www.googleapis.com/youtube/v3',
  ANALYTICS: 'https://youtubeanalytics.googleapis.com/v2',
  UPLOAD: 'https://www.googleapis.com/upload/youtube/v3',
  TOKEN: 'https://oauth2.googleapis.com/token',
} as const;
