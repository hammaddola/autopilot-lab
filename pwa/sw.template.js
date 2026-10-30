/* Autopilot Lab service worker — generated at build time from pwa/sw.template.js. */
const VERSION = '__VERSION__';
const PREFIX = 'autopilot-lab-shell-';
const CACHE = PREFIX + VERSION;
/** App-shell files only. User data (drivers, checkpoints) lives in IndexedDB and is never cached here. */
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  // No skipWaiting here: the page shows an "update available" prompt and the user decides when to switch.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Cache-first app shell; network when not cached; offline page as the last resort.
    event.respondWith(
      caches
        .match('./index.html', { cacheName: CACHE, ignoreVary: true })
        .then((hit) => hit || fetch(req))
        .catch(() => caches.match('./offline.html', { cacheName: CACHE, ignoreVary: true })),
    );
    return;
  }
  // ignoreVary: module scripts send an Origin header the precache request did not, and servers often send Vary.
  event.respondWith(
    caches
      .match(req, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true })
      .then((hit) => hit || fetch(req)),
  );
});
