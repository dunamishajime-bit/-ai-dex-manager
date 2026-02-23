// DIS TERMINAL - Service Worker (Phase 7 PWA)
const CACHE_NAME = 'dis-terminal-v1';
const STATIC_ASSETS = [
    '/',
    '/ai-agents',
    '/positions',
    '/watchlist',
    '/settings',
];

// Install: cache core pages
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch(() => {
                // Ignore cache errors (some pages may require auth)
            });
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// Fetch: network first, fall back to cache for navigation requests
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Only handle same-origin requests
    if (!request.url.startsWith(self.location.origin)) return;

    // For API calls: network only (no caching)
    if (request.url.includes('/api/')) return;

    // Navigation: network first with cache fallback
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Static assets: cache first
    if (
        request.destination === 'style' ||
        request.destination === 'script' ||
        request.destination === 'font'
    ) {
        event.respondWith(
            caches.match(request).then(
                (cached) => cached || fetch(request).then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
            )
        );
    }
});

// Push notifications
self.addEventListener('push', (event) => {
    const data = event.data?.json() || {};
    const title = data.title || 'DIS TERMINAL';
    const options = {
        body: data.body || 'AIエージェントからの通知',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag || 'dis-notification',
        data: { url: data.url || '/' },
        vibrate: [200, 100, 200],
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click: open relevant page
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                if (client.url === url && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
