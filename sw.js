const CACHE="routelog-v011";
const BASE="/RouteLog/";
const ASSETS=[
  BASE,
  BASE+"index.html",
  BASE+"style.css?v=011",
  BASE+"app.js?v=011",
  BASE+"mock-data.js?v=011",
  BASE+"manifest.json?v=011",
  BASE+"hero.jpg",
  BASE+"icon-192.png?v=011",
  BASE+"icon-512.png?v=011"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, {cache:"no-store"})
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(BASE+"index.html", copy));
          return res;
        })
        .catch(() => caches.match(BASE+"index.html").then(r => r || caches.match(BASE)))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
