// Formatters số/thời gian dùng chung cho UI.

const compactVI = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const numberVI = new Intl.NumberFormat('vi-VN');

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return compactVI.format(n);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return numberVI.format(n);
}

export function formatPct(n: number | null | undefined, { signed = true } = {}): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const abs = Math.abs(n).toFixed(1);
  const sign = signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : '';
  return `${sign}${abs}%`;
}

export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} phút`;
  return `${compactVI.format(h)}h`;
}

// Tỷ giá USD→VND. Ghi đè qua env NEXT_PUBLIC_USD_VND_RATE nếu cần.
// LƯU Ý: ước tính — production nên gọi FX API.
const USD_VND_RATE =
  Number(process.env.NEXT_PUBLIC_USD_VND_RATE) > 0
    ? Number(process.env.NEXT_PUBLIC_USD_VND_RATE)
    : 25_000;

export function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '—';
  return `$${numberVI.format(Math.round(usd * 100) / 100)}`;
}

export function formatVndFromUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '—';
  return `${compactVI.format(usd * USD_VND_RATE)}₫`;
}
