// Custom service worker code — next-pwa merge vào sw.js compiled.
// SCOPE: chỉ chứa logic Web Push (push + notificationclick events). Workbox
// caching strategies do next.config.js runtimeCaching tự handle.
//
// LƯU Ý: `self` trong SW context = ServiceWorkerGlobalScope. ESLint browser
// env phải bật. JS thuần (next-pwa hỗ trợ TS chưa hoàn thiện).

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Media Ops', body: event.data.text() };
  }

  const { title, body, icon, badge, tag, data } = payload;
  const notificationOptions = {
    body: body ?? '',
    icon: icon ?? '/icons/icon-192.png',
    badge: badge ?? '/icons/icon-192.png',
    tag: tag ?? 'media-ops-notification',
    data: data ?? {},
    // requireInteraction giữ notif hiện tới khi user tương tác (chỉ desktop)
    requireInteraction: false,
    timestamp: Date.now(),
  };

  event.waitUntil(
    self.registration.showNotification(title ?? 'Media Ops', notificationOptions),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data ?? {};
  const targetUrl = data.url ?? '/dashboard';
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    (async () => {
      // Nếu app đang mở ở 1 tab → focus tab + post message để client điều hướng
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          client.postMessage({ type: 'NAVIGATE', url: targetUrl, data });
          await client.focus();
          return;
        }
      }
      // Không có tab nào → open new
      if (self.clients.openWindow) {
        await self.clients.openWindow(fullUrl);
      }
    })(),
  );
});

// Subscription change (push service rotate keys hoặc user reinstall app)
// → re-subscribe + sync với server. Hiện tại chỉ log; client SW register
// hook sẽ tự re-subscribe sau khi user mở app lại.
self.addEventListener('pushsubscriptionchange', (event) => {
  // eslint-disable-next-line no-console
  console.log('[SW] pushsubscriptionchange — client phải re-subscribe', event);
});
