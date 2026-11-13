// PlatformOAuthService — entry point. Dispatch theo platform enum/string.
import { Platform } from '@prisma/client';
import type { OAuthAdapter } from './base';
import { facebookAdapter, tiktokAdapter, youtubeAdapter } from './adapters';

export const ADAPTERS: Record<Platform, OAuthAdapter> = {
  YOUTUBE: youtubeAdapter,
  FACEBOOK: facebookAdapter,
  TIKTOK: tiktokAdapter,
};

const URL_TO_PLATFORM: Record<string, Platform> = {
  youtube: Platform.YOUTUBE,
  facebook: Platform.FACEBOOK,
  tiktok: Platform.TIKTOK,
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
