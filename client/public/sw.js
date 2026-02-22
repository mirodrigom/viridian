const CACHE_NAME = 'viridian-v1';
const STATIC_ASSETS = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip WebSocket, API, Vite dev, and non-GET requests
  if (
    request.url.includes('/ws/') ||
    request.url.includes('/api/') ||
    request.url.includes('/@vite/') ||
    request.url.includes('/@fs/') ||
    request.url.includes('/src/') ||
    request.url.includes('node_modules') ||
    request.method !== 'GET'
  ) {
    return;
  }

  // Network-first for HTML, cache-first for assets
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request))
        .then((r) => r || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } }))
    );
  } else {
    event.respondWith(
      caches.match(request)
        .then((cached) => cached || fetch(request))
        .catch(() => new Response('', { status: 503 }))
    );
  }
});
