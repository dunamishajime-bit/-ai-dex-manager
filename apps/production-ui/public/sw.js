// Temporary no-op service worker.
// Older versions cached JS chunks and could keep serving stale assets after deploys.
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});
