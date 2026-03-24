const CACHE_NAME = 'premium-todo-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './icon.svg',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Use a Network-First strategy so that the latest code is always fetched
  // when online. If offline, fall back to the cached version.
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Clone the network response and put it in the cache for future offline use
        const cacheCopy = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, cacheCopy);
        });
        return networkResponse;
      })
      .catch(() => {
        // If fetch fails (offline), try the cache
        return caches.match(event.request);
      })
  );
});
