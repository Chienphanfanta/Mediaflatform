// Interface chuẩn cho mọi platform adapter.
import type { Platform } from '@prisma/client';

export type AuthUrlInput = {
  /** Param `state` đính kèm trong OAuth URL (anti-CSRF). */
  state: string;
  /** URL callback sẽ nhận `code`. */
  redirectUri: string;
};

export type AuthUrlResult = {
  url: string;
  /** Set khi platform dùng PKCE (X) — phải lưu phía server đến lúc callback. */
  codeVerifier?: string;
};

export type ExchangeInput = {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
};

export type AccountInfo = {
  /** ID account/channel/page tại platform. Map vào `Channel.accountId`. */
  externalId: string;
  /** Tên hiển thị. Map vào `Channel.name`. */
  name: string;
  /** Fields đặc thù platform → `Channel.metadata` Json. Xem CLAUDE.md §6. */
  metadata: Record<string, unknown>;
};

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  /** OAuth scope đã được cấp (space-separated). */
  scope: string | null;
  account: AccountInfo;
};

export type VerifyResult = {
  valid: boolean;
  /** Nếu invalid: message từ platform. */
  reason?: string;
  /** Nếu valid: account info từ token. */
  account?: { externalId: string; name: string };
};

export interface OAuthAdapter {
  platform: Platform;

  /**
   * Trả null cho platform KHÔNG dùng OAuth chuẩn (Telegram bot).
   * Caller cần chuyển sang flow nhập token thủ công.
   */
  generateAuthUrl(input: AuthUrlInput): AuthUrlResult | null;

  exchangeCode(input: ExchangeInput): Promise<TokenSet>;

  refreshAccessToken(refreshToken: string): Promise<TokenSet>;

  /** Best-effort revoke. Không throw nếu API platform fail — tiếp tục xoá DB. */
  revokeToken(accessToken: string): Promise<void>;

  verifyToken(accessToken: string): Promise<VerifyResult>;

  /**
   * Optional: kết nối qua token thủ công (Telegram bot token).
   * Trả về TokenSet như exchangeCode để pipeline tạo Channel dùng chung.
   */
  connectViaToken?(token: string, opts?: { name?: string }): Promise<TokenSet>;
}

/** Helper read env an toàn. */
export function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env: ${name}. Cần config OAuth credentials trong .env.local`,
    );
  }
  return v;
}
