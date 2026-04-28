// AES-256-GCM token encryption — server-side, dùng cho NestJS modules.
// Phải dùng CÙNG ENCRYPTION_KEY với apps/web để encrypt/decrypt cross-app được.
// (apps/web có copy logic giống ở src/lib/crypto/token-encryption.ts.)
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY chưa set (cần 64 hex chars / 32 bytes)');
  if (hex.length !== KEY_LENGTH * 2) {
    throw new Error(`ENCRYPTION_KEY phải 64 hex chars, đang là ${hex.length}`);
  }
  return Buffer.from(hex, 'hex');
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) throw new Error('encryptToken: plaintext rỗng');
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptToken(encoded: string): string {
  if (!encoded) throw new Error('decryptToken: encoded rỗng');
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('decryptToken: ciphertext quá ngắn');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const enc = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const dec = crypto.createDecipheriv(ALGO, key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

export function maskToken(t: string | null | undefined): string {
  if (!t) return '<empty>';
  if (t.length <= 12) return '*'.repeat(t.length);
  return `${t.slice(0, 5)}••••${t.slice(-3)}`;
}
