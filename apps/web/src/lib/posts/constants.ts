// Hằng số cho luồng đăng bài qua extension.

/** Số lần thử tối đa cho 1 target trước khi đánh dấu FAILED. */
export const MAX_ATTEMPTS = 3;

/** Target PUBLISHING quá lâu không báo kết quả → coi như kẹt (video lớn upload lâu). */
export const STALE_CLAIM_MS = 30 * 60 * 1000;
