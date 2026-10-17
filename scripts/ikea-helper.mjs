#!/usr/bin/env node
/**
 * Lokaler IKEA-Helfer für den Wohnungsplaner (Katalog › Abschnitt „IKEA“).
 *
 *   npm run ikea-helper            (oder: node scripts/ikea-helper.mjs [--port 4791])
 *
 * Läuft nur auf diesem Rechner (127.0.0.1) und beantwortet nur Anfragen der lokal
 * geöffneten Planer-App (Herkunft localhost/127.0.0.1). Pro eingefügter Artikelnummer
 * bzw. Produkt-URL ruft er wie `scripts/ikea-products.mjs` genau EINE öffentliche
 * Produktseite von IKEA Österreich ab (höchstens eine Anfrage alle 1,5 s) und auf
 * Wunsch das dort deklarierte 3D-Modell. Keine Suche, keine Konten, keine internen
 * IKEA-Schnittstellen. Ergebnisse werden in `ikea-import/auswahl/` zwischengespeichert
 * (Produktdaten 24 h, Modelle dauerhaft), damit dieselbe Seite nicht erneut abgerufen wird.
 *
 * Schnittstelle (für die App):
 *   GET /status                         → { ok, name, version }
 *   GET /product?article=<nr|url>[&model=1][&refresh=1]
 *                                       → { article, entry | null, model | null, reason?, note?, cached }
 *   GET /model/<datei>.glb              → 3D-Modell aus dem Zwischenspeicher
 *
 * 3D-Modelle und Bilder sind urheberrechtlich geschützt: nur privat nutzen.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fetchArticle, loadIkeaModules, politeFetcher } from './lib/ikea-fetch.mjs';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.IKEA_HELPER_PORT) || 4791;
const CACHE = resolve(process.env.IKEA_HELPER_CACHE || join('ikea-import', 'auswahl'));
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;
const VERSION = 1;

/** Only the planner opened on this computer may use the helper (no other website). */
function allowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

mkdirSync(CACHE, { recursive: true });
const mods = await loadIkeaModules();
const get = politeFetcher();

const keyOf = (a) => `${a.combination ? 's' : ''}${a.digits}`;

function readCached(key, wantModel) {
  const file = join(CACHE, `${key}.json`);
  if (!existsSync(file) || Date.now() - statSync(file).mtimeMs > ENTRY_TTL_MS) return null;
  const hit = JSON.parse(readFileSync(file, 'utf-8'));
  // a cached result without model does not answer a request that wants the model (unless none exists)
  if (wantModel && !hit.model && hit.modelAvailable) return null;
  return hit;
}

async function product(query) {
  const raw = query.get('article') ?? '';
  const [a] = mods.parseArticleList(raw);
  if (!a) return [400, { error: 'Keine IKEA-Artikelnummer erkannt (z. B. 104.099.32 oder ein Link zu ikea.com/at).' }];
  const key = keyOf(a);
  const wantModel = query.get('model') === '1';
  if (query.get('refresh') !== '1') {
    const hit = readCached(key, wantModel);
    if (hit) return [200, { ...hit, cached: true }];
  }
  const r = await fetchArticle(mods, get, a, { withModel: wantModel });
  if (r.model) writeFileSync(join(CACHE, r.model.file), r.model.bytes);
  const out = {
    article: r.article,
    entry: r.entry,
    model: r.model?.file ?? (existsSync(join(CACHE, `${key}.glb`)) ? `${key}.glb` : null),
    modelAvailable: !!r.page?.modelUrl,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.note ? { note: r.note } : {}),
  };
  if (out.entry && out.model && !out.entry.modelFile) out.entry = { ...out.entry, modelFile: out.model };
  if (r.entry) writeFileSync(join(CACHE, `${key}.json`), JSON.stringify(out, null, 2));
  console.log(`${r.article}: ${r.entry ? `${r.entry.name}${out.model ? ' + Modell' : ''}` : r.reason}`);
  return [200, { ...out, cached: false }];
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Nur für den lokal geöffneten Wohnungsplaner.');
    return;
  }
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-methods': 'GET', 'access-control-allow-private-network': 'true', 'access-control-max-age': '600' }).end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const json = (status, body) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  try {
    if (req.method !== 'GET') return json(405, { error: 'Nur GET.' });
    if (url.pathname === '/status') return json(200, { ok: true, name: 'wohnungsplaner-ikea-helper', version: VERSION });
    if (url.pathname === '/product') {
      const [status, body] = await product(url.searchParams);
      return json(status, body);
    }
    const m = url.pathname.match(/^\/model\/(s?\d{8}\.glb)$/);
    if (m && existsSync(join(CACHE, m[1]))) {
      res.writeHead(200, { 'content-type': 'model/gltf-binary' }).end(readFileSync(join(CACHE, m[1])));
      return;
    }
    json(404, { error: 'Nicht gefunden.' });
  } catch (e) {
    console.error(e);
    json(502, { error: `Abruf fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}` });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`IKEA-Helfer läuft auf http://127.0.0.1:${PORT} – Fenster offen lassen, Beenden mit Strg+C.`);
  console.log(`Zwischenspeicher: ${CACHE}`);
});
const stop = () => server.close(() => mods.vite.close().then(() => process.exit(0)));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
