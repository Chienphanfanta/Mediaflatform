// Kịch bản tự đăng bài cho browser extension — DỮ LIỆU khai báo, không phải code.
//
// Server phục vụ qua GET /api/v1/ext/flows → extension cache lại. Khi Facebook/TikTok/
// YouTube đổi giao diện: sửa selector/nhãn ở file này (hoặc override qua env) và deploy
// web — KHÔNG cần cài lại extension trên từng máy.
//
// Mỗi Target có nhiều phương án: danh sách CSS selector và/hoặc nhãn hiển thị
// (text / aria-label, so khớp chính xác sau khi chuẩn hoá) — EN + VI vì giao diện
// nền tảng theo ngôn ngữ tài khoản.

export type FlowPlatform = 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK';

export type FlowTarget = {
  /** CSS selector — thử lần lượt, lấy phần tử hiển thị đầu tiên */
  css?: string[];
  /** Nhãn (innerText hoặc aria-label) — so khớp chính xác, không phân biệt hoa thường */
  text?: string[];
  /** Khi dùng `text`: chỉ tìm trong các phần tử khớp selector này (mặc định button-like) */
  textScope?: string;
};

/** Điều kiện chạy bước. */
export type FlowWhen = 'hasMedia' | 'hasVideo' | 'hasImages' | 'hasTitle' | 'noMedia';

/** Giá trị cần gõ. body = caption + hashtag. */
export type FlowValue = 'title' | 'caption' | 'body';

type StepBase = {
  /** Mô tả ngắn — hiện trong log + thông báo lỗi */
  label: string;
  /** Bước không bắt buộc: không tìm thấy thì bỏ qua thay vì báo lỗi */
  optional?: boolean;
  timeoutMs?: number;
  when?: FlowWhen;
};

export type FlowStep =
  | (StepBase & { do: 'wait'; target: FlowTarget })
  | (StepBase & { do: 'click'; target: FlowTarget; waitEnabled?: boolean })
  | (StepBase & { do: 'upload'; target: FlowTarget })
  | (StepBase & { do: 'type'; target: FlowTarget; value: FlowValue; clear?: boolean })
  | (StepBase & { do: 'sleep'; ms: number })
  | (StepBase & { do: 'waitText'; target: FlowTarget; anyOf: string[] })
  | (StepBase & { do: 'waitUrl'; includes: string[] })
  | (StepBase & { do: 'captureUrl'; target: FlowTarget; attr?: string })
  | (StepBase & {
      do: 'choosePrivacy';
      /** privacy value → phần tử cần bấm */
      map: Partial<Record<'public' | 'private' | 'unlisted' | 'friends', FlowTarget>>;
    });

export type PlatformFlow = {
  platform: FlowPlatform;
  /** Tăng khi sửa flow — extension log version để debug */
  version: number;
  /**
   * URL mở tab đăng bài. Placeholder: {accountId} {username}
   * (lấy từ Channel.accountId / Channel.metadata.username)
   */
  openUrl: string;
  /** Link dự phòng khi không bắt được link bài (vd trang kênh) */
  fallbackUrl?: string;
  steps: FlowStep[];
};

export type ExtensionFlowsConfig = {
  version: number;
  /** Khoảng nghỉ tối thiểu giữa 2 lần đăng trên cùng 1 trình duyệt (ms) */
  minGapBetweenPostsMs: number;
  flows: Record<FlowPlatform, PlatformFlow>;
};

const BUTTON_SCOPE = 'button, [role="button"], tp-yt-paper-button, ytcp-button';

// ─────────────────────────────────────────────────────────────────────────────
// YouTube Studio — upload video
// ─────────────────────────────────────────────────────────────────────────────
const YOUTUBE_FLOW: PlatformFlow = {
  platform: 'YOUTUBE',
  version: 1,
  openUrl: 'https://studio.youtube.com/channel/{accountId}/videos/upload?d=ud',
  fallbackUrl: 'https://www.youtube.com/channel/{accountId}/videos',
  steps: [
    {
      do: 'upload',
      label: 'Chọn file video',
      timeoutMs: 60_000,
      target: {
        css: [
          'ytcp-uploads-file-picker input[type="file"]',
          'input[type="file"][name="Filedata"]',
          'input[type="file"]',
        ],
      },
    },
    {
      do: 'type',
      label: 'Nhập tiêu đề',
      value: 'title',
      clear: true,
      timeoutMs: 90_000,
      target: { css: ['#title-textarea #textbox', 'ytcp-social-suggestions-textbox#title-textarea #textbox'] },
    },
    {
      do: 'type',
      label: 'Nhập mô tả',
      value: 'body',
      clear: true,
      target: { css: ['#description-textarea #textbox', 'ytcp-social-suggestions-textbox#description-textarea #textbox'] },
    },
    {
      do: 'click',
      label: 'Chọn "Không dành cho trẻ em"',
      target: {
        css: [
          'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
          '[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
        ],
      },
    },
    { do: 'click', label: 'Tiếp (1/3)', waitEnabled: true, target: { css: ['#next-button'] } },
    { do: 'sleep', label: 'Chờ chuyển bước', ms: 1500 },
    { do: 'click', label: 'Tiếp (2/3)', waitEnabled: true, target: { css: ['#next-button'] } },
    { do: 'sleep', label: 'Chờ chuyển bước', ms: 1500 },
    { do: 'click', label: 'Tiếp (3/3)', waitEnabled: true, target: { css: ['#next-button'] } },
    { do: 'sleep', label: 'Chờ chuyển bước', ms: 1500 },
    {
      do: 'choosePrivacy',
      label: 'Chọn chế độ hiển thị',
      map: {
        public: { css: ['tp-yt-paper-radio-button[name="PUBLIC"]', '[name="PUBLIC"]'] },
        unlisted: { css: ['tp-yt-paper-radio-button[name="UNLISTED"]', '[name="UNLISTED"]'] },
        private: { css: ['tp-yt-paper-radio-button[name="PRIVATE"]', '[name="PRIVATE"]'] },
      },
    },
    {
      do: 'waitText',
      label: 'Chờ upload video xong',
      timeoutMs: 60 * 60_000,
      target: { css: ['ytcp-video-upload-progress .progress-label', '.progress-label'] },
      anyOf: [
        'upload complete',
        'checks complete',
        'processing',
        'đã tải lên',
        'tải lên hoàn tất',
        'đã kiểm tra xong',
        'đang xử lý',
        'hoàn tất quá trình kiểm tra',
      ],
    },
    {
      do: 'captureUrl',
      label: 'Lấy link video',
      optional: true,
      attr: 'href',
      target: { css: ['ytcp-video-info a.ytcp-video-info', 'ytcp-video-info a', '.video-url-fadeable a'] },
    },
    { do: 'click', label: 'Bấm Lưu/Xuất bản', waitEnabled: true, target: { css: ['#done-button'] } },
    { do: 'sleep', label: 'Chờ YouTube ghi nhận', ms: 4000 },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// TikTok Studio — upload video/ảnh
// ─────────────────────────────────────────────────────────────────────────────
const TIKTOK_FLOW: PlatformFlow = {
  platform: 'TIKTOK',
  version: 1,
  openUrl: 'https://www.tiktok.com/tiktokstudio/upload?from=webapp',
  fallbackUrl: 'https://www.tiktok.com/@{username}',
  steps: [
    {
      do: 'upload',
      label: 'Chọn file',
      timeoutMs: 60_000,
      target: { css: ['input[type="file"][accept*="video"]', 'input[type="file"]'] },
    },
    {
      do: 'type',
      label: 'Nhập mô tả',
      value: 'body',
      clear: true,
      timeoutMs: 120_000,
      target: {
        css: [
          '.public-DraftEditor-content[contenteditable="true"]',
          'div[contenteditable="true"][role="combobox"]',
          'div[contenteditable="true"]',
        ],
      },
    },
    { do: 'sleep', label: 'Đóng gợi ý hashtag', ms: 1500 },
    {
      do: 'click',
      label: 'Bấm Đăng (chờ upload xong)',
      waitEnabled: true,
      timeoutMs: 60 * 60_000,
      target: {
        css: ['button[data-e2e="post_video_button"]'],
        text: ['Post', 'Đăng'],
        textScope: 'button',
      },
    },
    {
      do: 'click',
      label: 'Xác nhận "Đăng ngay"',
      optional: true,
      timeoutMs: 8000,
      target: { text: ['Post now', 'Đăng ngay'], textScope: BUTTON_SCOPE },
    },
    {
      do: 'waitUrl',
      label: 'Chờ TikTok xác nhận đã đăng',
      optional: true,
      timeoutMs: 180_000,
      includes: ['/tiktokstudio/content', '/tiktokstudio/manage', '/@'],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Facebook Page — Meta Business Suite composer (đăng dưới danh nghĩa Page)
// ─────────────────────────────────────────────────────────────────────────────
const FACEBOOK_FLOW: PlatformFlow = {
  platform: 'FACEBOOK',
  version: 1,
  openUrl: 'https://business.facebook.com/latest/composer/?asset_id={accountId}&context_ref=HOME',
  fallbackUrl: 'https://www.facebook.com/{accountId}',
  steps: [
    {
      do: 'wait',
      label: 'Mở trình soạn bài',
      timeoutMs: 90_000,
      target: { css: ['div[role="textbox"][contenteditable="true"]'] },
    },
    {
      do: 'upload',
      label: 'Thêm ảnh/video',
      when: 'hasMedia',
      timeoutMs: 30_000,
      target: {
        css: [
          'input[type="file"][accept*="video"]',
          'input[type="file"][accept*="image"]',
          'input[type="file"]',
        ],
      },
    },
    {
      do: 'type',
      label: 'Nhập nội dung',
      value: 'body',
      clear: true,
      target: { css: ['div[role="textbox"][contenteditable="true"]'] },
    },
    { do: 'sleep', label: 'Chờ xem trước', ms: 3000 },
    {
      do: 'click',
      label: 'Bấm Đăng (chờ media xử lý xong)',
      waitEnabled: true,
      timeoutMs: 30 * 60_000,
      target: {
        text: ['Publish', 'Post', 'Share now', 'Đăng', 'Chia sẻ ngay', 'Đăng ngay'],
        textScope: BUTTON_SCOPE,
      },
    },
    {
      do: 'waitUrl',
      label: 'Chờ Facebook xác nhận đã đăng',
      optional: true,
      timeoutMs: 120_000,
      includes: ['/latest/posts', '/latest/content', '/latest/home', '/latest/inbox'],
    },
    { do: 'sleep', label: 'Chờ Facebook ghi nhận', ms: 3000 },
  ],
};

export const DEFAULT_EXTENSION_FLOWS: ExtensionFlowsConfig = {
  version: 1,
  minGapBetweenPostsMs: 60_000,
  flows: {
    YOUTUBE: YOUTUBE_FLOW,
    TIKTOK: TIKTOK_FLOW,
    FACEBOOK: FACEBOOK_FLOW,
  },
};
