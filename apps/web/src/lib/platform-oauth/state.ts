// Sign/verify OAuth flow state. Lưu trong HttpOnly cookie suốt connect → callback.
// Cookie HMAC bảo vệ tampering (CSRF). PKCE verifier chỉ ở server (không lộ ra URL).
import crypto from 'node:crypto';

const COOKIE_NAME = 'media_ops_oauth_flow';
const TTL_MS = 10 * 60 * 1000; // 10 phút

export type FlowState = {
  platform: string; // viết thường — match URL param
  groupId: string;
  redirectUri: string;
  /** Random — dùng làm `state` query param trong OAuth URL (anti-CSRF). */
  nonce: string;
  /** PKCE verifier (chỉ X). */
  codeVerifier?: string;
  /** Unix ms expiry. */
  exp: number;
};

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET chưa set');
  return s;
}

export function signState(
  payload: Omit<FlowState, 'exp' | 'nonce'> & { nonce?: string },
): string {
  const data: FlowState = {
    ...payload,
    nonce: payload.nonce ?? crypto.randomBytes(16).toString('base64url'),
    exp: Date.now() + TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyState(token: string | undefined | null): FlowState | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(encoded)
    .digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as FlowState;
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export const FLOW_COOKIE = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: TTL_MS / 1000,
  },
};

/** Random nonce (cho extra anti-replay nếu cần). */
export function randomNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}
