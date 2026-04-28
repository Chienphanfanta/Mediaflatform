// Viewport breakpoint hooks — match Tailwind config:
//   mobile  < 640
//   tablet  640..1023
//   desktop ≥ 1024
//
// SSR-safe: trước khi mount trả về `null` (chưa biết) — caller có thể
// fallback render desktop layout (default ở Tailwind class) trong lần render đầu.
//
// LƯU Ý: Tránh dùng để switch hidden/visible logic ở client component nếu
// CSS Tailwind đã đủ — chỉ dùng khi cần JS branching (vd: mở Sheet vs Dialog).
'use client';

import { useEffect, useState } from 'react';

const MOBILE_MAX = 639;
const TABLET_MAX = 1023;

export type Viewport = 'mobile' | 'tablet' | 'desktop';

function compute(width: number): Viewport {
  if (width <= MOBILE_MAX) return 'mobile';
  if (width <= TABLET_MAX) return 'tablet';
  return 'desktop';
}

/**
 * Trả `true` khi viewport ≤ MOBILE_MAX (639px).
 * Trước hydration trả `false` (= không phải mobile) → match render server.
 * Caller cần render thật chuẩn nên gắn `mobile:` class Tailwind thay vì JS-branch.
 */
export function useMobile(): boolean {
  return useViewport() === 'mobile';
}

export function useTablet(): boolean {
  return useViewport() === 'tablet';
}

export function useDesktop(): boolean {
  return useViewport() === 'desktop';
}

/** Trả viewport hiện tại; trước hydration default `'desktop'`. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>('desktop');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = () => setVp(compute(window.innerWidth));
    update();

    // matchMedia listener — chỉ fire khi crossing boundary, rẻ hơn resize
    const mq1 = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);
    const mq2 = window.matchMedia(
      `(min-width: ${MOBILE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`,
    );
    mq1.addEventListener('change', update);
    mq2.addEventListener('change', update);
    return () => {
      mq1.removeEventListener('change', update);
      mq2.removeEventListener('change', update);
    };
  }, []);

  return vp;
}
