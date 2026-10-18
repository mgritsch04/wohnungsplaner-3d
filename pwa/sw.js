// Service Worker der installierbaren Web-App (#179). Nur im GitHub-Pages-Build (`--mode pages`);
// der normale Build und das Claude-Artefakt registrieren ihn nicht.
// __VERSION__ und __PRECACHE__ setzt pwa/plugin.ts beim Build ein.
//  - Beim Installieren werden alle Build-Dateien vorgeladen → die App startet auch offline.
//  - Seitenaufrufe: erst Netz (neue Version), sonst Zwischenspeicher.
//  - Übrige Dateien derselben Herkunft (z. B. draco/): Zwischenspeicher, sonst Netz und merken.
//  - Fremde Adressen (Händler-Modelle, IKEA-Helfer auf 127.0.0.1) werden nicht angefasst.
// Die Pläne selbst liegen in IndexedDB und werden von hier nie gelesen oder gelöscht.
const VERSION = '__VERSION__';
const CACHE = `wohnungsplaner-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, self.registration.scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('wohnungsplaner-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(new URL('./', self.registration.scope).href, copy));
          }
          return res;
        })
        .catch(() => caches.match(new URL('./', self.registration.scope).href, { ignoreSearch: true })),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
