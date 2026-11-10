// CarromHub service worker: app shell cached for offline/instant launch; API always goes to the network.
const VERSION = 'carromhub-v4';
const SHELL = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/js/data/rules.js', '/js/data/mock.js', '/js/data/bodies.js', '/js/data/champions.js', '/manifest.webmanifest', '/icons/icon.svg', '/icons/maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Stale-while-revalidate for the shell so updates land on the next launch.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((res) => {
        if (res.ok) caches.open(VERSION).then((cache) => cache.put(event.request, res.clone()));
        return res;
      }).catch(() => cached || caches.match('/index.html'));
      return cached || network;
    })
  );
});

self.addEventListener('message', (event) => { if (event.data === 'skipWaiting') self.skipWaiting(); });
