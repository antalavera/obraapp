/* Service Worker v5 - Notificaciones push + NO CACHE en JS/CSS */
const CACHE = 'obraapp-v5';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (['.js','.css','.html'].some(ext => url.pathname.endsWith(ext))) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return r;
    }).catch(() => caches.match(e.request))
  );
});

/* ── Notificaciones programadas ── */
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFICATIONS') {
    scheduleNotifications(e.data.alertas);
  }
});

async function scheduleNotifications(alertas) {
  // Limpiar notificaciones anteriores
  const notifs = await self.registration.getNotifications();
  notifs.forEach(n => n.close());
}

/* ── Click en notificación → abrir app ── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      // Si la app ya está abierta, enfocarla
      if (cls.length > 0) {
        cls[0].focus();
        cls[0].postMessage({ type: 'NOTIFICATION_CLICK', data });
      } else {
        clients.openWindow('/');
      }
    })
  );
});
