/** @type {import('next').NextConfig} */
// Next.js config - bật transpile cho shared packages trong monorepo + PWA.
const withPWA = require('next-pwa')({
  dest: 'public',
  // Tắt SW trong dev — tránh cache stale lúc HMR.
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  // Custom worker code (push + click handlers) — file `worker/index.js`
  // được next-pwa append vào sw.js compiled.
  customWorkerDir: 'worker',
  // Trang fallback khi offline + asset chưa precache. Routing layer của Workbox
  // gọi vào trang này khi navigation network fail.
  fallbacks: {
    document: '/offline',
  },
  // Runtime caching strategies — xem CLAUDE.md / scheduler-patterns.md cho convention.
  runtimeCaching: [
    // ── Static assets: cache-first ──
    {
      urlPattern: /\.(?:js|css|woff2?)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-assets',
        expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }, // 30 ngày
      },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    // ── Fonts (Google Fonts hoặc tự host): stale-while-revalidate ──
    {
      urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'google-fonts',
        expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, // 1 năm
      },
    },
    // ── API calls: network-first (luôn ưu tiên data mới, fallback cache khi offline) ──
    {
      urlPattern: /^\/api\/v1\/.*$/i,
      handler: 'NetworkFirst',
      method: 'GET',
      options: {
        cacheName: 'api-v1',
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 }, // 1 giờ
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    // ── Auth endpoints: KHÔNG cache (cookie-driven) ──
    {
      urlPattern: /^\/api\/auth\/.*$/i,
      handler: 'NetworkOnly',
    },
    // ── Mutations: KHÔNG cache (POST/PATCH/DELETE) ──
    // next-pwa default chỉ cache GET; mutations đi thẳng network. KHÔNG cần rule riêng.
    // ── Page navigations: stale-while-revalidate cho route đã visit ──
    {
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'pages',
        networkTimeoutSeconds: 3,
        expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 }, // 1 ngày
      },
    },
  ],
});

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@media-ops/shared'],
  experimental: {
    // @react-pdf/renderer dùng Node-only APIs (canvas, fs) — không bundle vào client.
    serverComponentsExternalPackages: ['@react-pdf/renderer'],
  },
};

module.exports = withPWA(nextConfig);
