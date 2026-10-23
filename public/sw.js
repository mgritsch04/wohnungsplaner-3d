/*
 * Offline-Hülle (#361): der Laden-Modus muss im Möbelhaus auch ohne Netz starten.
 * - Seitenaufruf: erst Netz (damit Updates ankommen), ohne Netz die zuletzt geladene Seite.
 * - Dateien derselben Herkunft (Skripte, Stile, Symbole): aus dem Cache, wenn vorhanden, sonst Netz
 *   und merken. Die Dateinamen unter /assets/ enthalten einen Hash und ändern sich mit jedem Build.
 * Projekte liegen ohnehin lokal (IndexedDB); fremde Herkunft (z. B. Händlerseiten) fasst dieser Worker nicht an.
 */
const CACHE = 'wohnungsplaner-shell-v1';
const MAX_ENTRIES = 300;
const SHELL = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function remember(request, response) {
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(k);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) event.waitUntil(remember(SHELL, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(SHELL)) ?? Response.error()),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) event.waitUntil(remember(req, res.clone()));
          return res;
        }),
    ),
  );
});
