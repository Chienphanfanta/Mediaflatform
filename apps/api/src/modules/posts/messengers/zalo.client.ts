// Zalo Official Account API — gửi tin nhắn tư vấn (cs) để nhắc nhân viên.
//
// Token: access_token OA sống ~25 giờ; refresh_token dùng 1 lần (mỗi lần refresh trả
// refresh_token MỚI, cái cũ hết hiệu lực) → lưu refresh_token mới nhất trong Redis,
// env ZALO_OA_REFRESH_TOKEN chỉ dùng cho lần đầu.
//
// Giới hạn của Zalo: tin "tư vấn" chỉ gửi được cho người đã quan tâm OA và có tương
// tác với OA trong 7 ngày gần nhất. Ngoài khung đó cần tin ZNS (template được duyệt).
import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../../lib/redis.service';

const OAUTH_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const SEND_URL = 'https://openapi.zalo.me/v3.0/oa/message/cs';
const ACCESS_KEY = 'zalo:oa:access_token';
const REFRESH_KEY = 'zalo:oa:refresh_token';

@Injectable()
export class ZaloClient {
  private readonly logger = new Logger(ZaloClient.name);

  constructor(private readonly redis: RedisService) {}

  get enabled(): boolean {
    return !!(process.env.ZALO_APP_ID && process.env.ZALO_APP_SECRET);
  }

  async sendText(userId: string, text: string): Promise<boolean> {
    if (!this.enabled) return false;
    const token = await this.getAccessToken();
    if (!token) return false;
    try {
      const res = await fetch(SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: token },
        body: JSON.stringify({ recipient: { user_id: userId }, message: { text } }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
      if (data.error && data.error !== 0) {
        // -216: token hết hạn → xoá cache để lần sau refresh
        if (data.error === -216 || data.error === -124) await this.redis.del(ACCESS_KEY);
        this.logger.warn(`Zalo send fail user=${userId}: ${data.error} ${data.message ?? ''}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`Zalo send error: ${(e as Error).message}`);
      return false;
    }
  }

  private async getAccessToken(): Promise<string | null> {
    const cached = await this.redis.get(ACCESS_KEY);
    if (cached) return cached;

    const refresh = (await this.redis.get(REFRESH_KEY)) ?? process.env.ZALO_OA_REFRESH_TOKEN;
    if (!refresh) {
      this.logger.warn('Zalo: thiếu ZALO_OA_REFRESH_TOKEN');
      return null;
    }
    try {
      const res = await fetch(OAUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          secret_key: process.env.ZALO_APP_SECRET ?? '',
        },
        body: new URLSearchParams({
          refresh_token: refresh,
          app_id: process.env.ZALO_APP_ID ?? '',
          grant_type: 'refresh_token',
        }),
      });
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: string | number;
        error?: number;
        error_description?: string;
      };
      if (!data.access_token || !data.refresh_token) {
        this.logger.error(`Zalo refresh token fail: ${data.error} ${data.error_description ?? ''}`);
        return null;
      }
      const ttl = Math.max(60, Number(data.expires_in ?? 3600) - 300);
      await this.redis.set(ACCESS_KEY, data.access_token, ttl);
      await this.redis.set(REFRESH_KEY, data.refresh_token); // refresh token mới (dùng 1 lần)
      return data.access_token;
    } catch (e) {
      this.logger.error(`Zalo refresh error: ${(e as Error).message}`);
      return null;
    }
  }
}
