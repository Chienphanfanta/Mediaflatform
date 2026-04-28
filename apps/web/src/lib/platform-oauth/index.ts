// PlatformOAuthService — entry point. Dispatch theo platform enum/string.
import { Platform } from '@prisma/client';
import type { OAuthAdapter } from './base';
import {
  facebookAdapter,
  instagramAdapter,
  telegramAdapter,
  whatsappAdapter,
  xAdapter,
  youtubeAdapter,
} from './adapters';

export const ADAPTERS: Record<Platform, OAuthAdapter> = {
  YOUTUBE: youtubeAdapter,
  FACEBOOK: facebookAdapter,
  INSTAGRAM: instagramAdapter,
  X: xAdapter,
  TELEGRAM: telegramAdapter,
  WHATSAPP: whatsappAdapter,
};

const URL_TO_PLATFORM: Record<string, Platform> = {
  youtube: Platform.YOUTUBE,
  facebook: Platform.FACEBOOK,
  instagram: Platform.INSTAGRAM,
  x: Platform.X,
  twitter: Platform.X, // alias
  telegram: Platform.TELEGRAM,
  whatsapp: Platform.WHATSAPP,
};

export function platformFromSlug(slug: string): Platform | null {
  return URL_TO_PLATFORM[slug.toLowerCase()] ?? null;
}

export function getAdapter(platform: Platform): OAuthAdapter {
  return ADAPTERS[platform];
}

export {
  type OAuthAdapter,
  type TokenSet,
  type VerifyResult,
  type AccountInfo,
} from './base';
