// Telegram Bot API — chỉ dùng để NHẮC VIỆC cho nhân viên (không phải nền tảng đăng bài).
//
// Liên kết tài khoản: web tạo mã → nhân viên mở t.me/<bot>?start=<mã> → bot nhận
// "/start <mã>" qua getUpdates (long polling, không cần webhook/public URL) → lưu chat_id.
import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../../lib/redis.service';

const API = 'https://api.telegram.org';
const OFFSET_KEY = 'telegram:updates:offset';

export type TelegramStartCommand = { chatId: string; code: string; fromName: string };

type TgUpdate = {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { first_name?: string; last_name?: string; username?: string };
    text?: string;
  };
};

@Injectable()
export class TelegramClient {
  private readonly logger = new Logger(TelegramClient.name);

  constructor(private readonly redis: RedisService) {}

  get enabled(): boolean {
    return !!process.env.TELEGRAM_BOT_TOKEN;
  }

  private url(method: string): string {
    return `${API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
  }

  async sendMessage(chatId: string, text: string): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const res = await fetch(this.url('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (!data.ok) {
        this.logger.warn(`Telegram sendMessage fail chat=${chatId}: ${data.description ?? res.status}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`Telegram sendMessage error: ${(e as Error).message}`);
      return false;
    }
  }

  /** Đọc tin nhắn mới, trả các lệnh "/start <mã>" để liên kết tài khoản. */
  async pollStartCommands(): Promise<TelegramStartCommand[]> {
    if (!this.enabled) return [];
    const offset = Number((await this.redis.get(OFFSET_KEY)) ?? 0);
    let updates: TgUpdate[] = [];
    try {
      const res = await fetch(
        `${this.url('getUpdates')}?timeout=0&allowed_updates=["message"]${offset ? `&offset=${offset}` : ''}`,
      );
      const data = (await res.json()) as { ok: boolean; result?: TgUpdate[]; description?: string };
      if (!data.ok) {
        // 409 = bot đang dùng webhook → getUpdates không dùng được
        this.logger.warn(`Telegram getUpdates fail: ${data.description}`);
        return [];
      }
      updates = data.result ?? [];
    } catch (e) {
      this.logger.warn(`Telegram getUpdates error: ${(e as Error).message}`);
      return [];
    }
    if (updates.length === 0) return [];
    await this.redis.set(OFFSET_KEY, String(updates[updates.length - 1].update_id + 1));

    const out: TelegramStartCommand[] = [];
    for (const u of updates) {
      const m = u.message;
      const match = m?.text?.trim().match(/^\/start\s+([A-Za-z0-9_-]{6,64})$/);
      if (!m || m.chat.type !== 'private' || !match) continue;
      out.push({
        chatId: String(m.chat.id),
        code: match[1],
        fromName: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' '),
      });
    }
    return out;
  }
}

/** Escape cho parse_mode=HTML */
export function tgEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
