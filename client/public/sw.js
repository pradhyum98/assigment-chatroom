const CACHE_NAME = 'secure-chat-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

// ── Install: cache static shell ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clear old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for HTML, cache-first for assets ─────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, dev hot reload, socket connections, and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.pathname.includes('hot-update') || url.pathname.includes('socket.io')) return;
  if (!url.origin.includes(self.location.hostname) && !url.hostname.includes('onrender.com')) return;

  // API calls: always try network first, never cache
  if (url.pathname.startsWith('/api') || url.hostname.includes('onrender.com')) {
    event.respondWith(fetch(request).catch(() => new Response('Offline', { status: 503 })));
    return;
  }

  // Network-First for main root document, index.html, and manifest.json to prevent stale cached app shell
  const isDocument = url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname === '/manifest.json';
  if (isDocument) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Static assets (hashed assets, images): cache-first with network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', function (event) {
  if (event.data) {
    try {
      const payload = event.data.json();
      let displayBody = payload.body || 'New message received';
      
      // If the body is a single long ciphertext string, mask it
      if (displayBody.length > 20 && !displayBody.includes(' ')) {
        displayBody = '🔒 New Encrypted Message';
      }
      
      const options = {
        body: displayBody,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: payload.url || '/' },
        vibrate: [100, 50, 100],
      };
      event.waitUntil(
        self.registration.showNotification(payload.title || 'New Message', options)
      );
    } catch (e) {
      let fallbackBody = 'New message received';
      const text = event.data.text();
      if (text && text.length > 20 && !text.includes(' ')) {
        fallbackBody = '🔒 New Encrypted Message';
      }
      event.waitUntil(
        self.registration.showNotification('New Message', {
          body: fallbackBody,
          icon: '/icon-192.png',
        })
      );
    }
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// ── Skip Waiting message listener for client update triggers ────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

