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
 * Lesezeichen „An Planer senden“ (#221): Auf einer Produktseite von ikea.com oder moebelix.at,
 * die du selbst im Browser geöffnet hast, blendet das Lesezeichen die kleine Empfangsseite
 * des Helfers (/empfang) ein und reicht ihr per postMessage die strukturierten Daten DIESER
 * Seite (schema.org/JSON-LD, Meta-Angaben, Seitentext) samt geheimem Token aus
 * `ikea-import/auswahl/.lesezeichen-token` (beim ersten Start erzeugt, nie im Repository).
 * (Direkte Abrufe von ikea.com zum Helfer verbietet die Content-Security-Policy der Seite,
 * eingebettete Seiten erlaubt sie.) Der Planer holt die Einträge ab. Für IKEA lädt der Helfer
 * das auf der Seite deklarierte 3D-Modell (nur von web-api.ikea.com/dimma/assets).
 *
 * Schnittstelle (für die App):
 *   GET /status                         → { ok, name, version }
 *   GET /bookmarklet                    → { token }   (nur für den lokalen Planer)
 *   GET /empfang                        → Empfangsseite für das Lesezeichen (nur in ikea.com/moebelix.at eingebettet)
 *   POST /inbox  { token, url, html }   → { name }    (von der Empfangsseite)
 *   GET /inbox                          → { items: [{ id, receivedAt, product }] }
 *   POST /inbox/ack { ids }             → { ok }
 *   GET /product?article=<nr|url>[&model=1][&refresh=1]
 *                                       → { article, entry | null, model | null, reason?, note?, cached }
 *   GET /model/<datei>.glb              → 3D-Modell aus dem Zwischenspeicher
 *   GET /image/<datei>                  → Produktfoto einer gesendeten Seite ohne 3D-Modell (#273)
 *
 * 3D-Modelle und Bilder sind urheberrechtlich geschützt: nur privat nutzen.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fetchArticle, fetchIkeaModel, fetchProductImage, loadIkeaModules, politeFetcher } from './lib/ikea-fetch.mjs';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.IKEA_HELPER_PORT) || 4791;
const CACHE = resolve(process.env.IKEA_HELPER_CACHE || join('ikea-import', 'auswahl'));
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;
const VERSION = 2;
const MAX_BODY = 3 * 1024 * 1024;
/** Shops whose product pages the bookmarklet may send (the page the user has open, one per click). */
const SHOP_ORIGINS = ['https://www.ikea.com', 'https://www.moebelix.at'];

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
const TOKEN_FILE = join(CACHE, '.lesezeichen-token');
if (!existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, randomBytes(24).toString('hex'), { mode: 0o600 });
const TOKEN = readFileSync(TOKEN_FILE, 'utf-8').trim();
const INBOX_FILE = join(CACHE, 'lesezeichen-eingang.json');
let inbox = existsSync(INBOX_FILE) ? JSON.parse(readFileSync(INBOX_FILE, 'utf-8')) : [];
const saveInbox = () => writeFileSync(INBOX_FILE, JSON.stringify(inbox, null, 2));
const tokenOk = (t) => typeof t === 'string' && t.length === TOKEN.length && timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN));
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
    ...(r.draft ? { draft: r.draft } : {}),
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

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error('Seite zu groß'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', fail);
  });
}

/** A product page sent by the bookmarklet: parse it like a pasted page; IKEA models come from IKEA's asset host only. */
async function receivePage(body) {
  if (!tokenOk(body?.token)) return [403, { error: 'Lesezeichen ungültig – bitte im Planer (Katalog › IKEA) neu einrichten.' }];
  let url;
  try {
    url = new URL(String(body.url));
  } catch {
    return [400, { error: 'Keine Seitenadresse.' }];
  }
  if (!SHOP_ORIGINS.includes(url.origin)) return [400, { error: 'Das geht nur auf Produktseiten von ikea.com oder moebelix.at.' }];
  const page = mods.parseProductPage(String(body.html ?? ''), url.href);
  const isIkea = page.provider === 'ikea-at';
  const digits = isIkea && page.articleNumber ? page.articleNumber.replace(/[^\dSs]/g, '').toLowerCase() : null;
  const key = digits && /^s?\d{8}$/.test(digits) ? digits : `mx${createHash('sha1').update(page.productUrl ?? url.href).digest('hex').slice(0, 10)}`;
  let modelFile = isIkea && existsSync(join(CACHE, `${key}.glb`)) ? `${key}.glb` : undefined;
  let note;
  if (isIkea && !modelFile && page.modelUrl && digits) {
    const m = await fetchIkeaModel(get, page.modelUrl);
    if (m.bytes) {
      modelFile = `${key}.glb`;
      writeFileSync(join(CACHE, modelFile), m.bytes);
    } else note = m.note;
  }
  // no 3D model (Möbelix, #273): the page's own product photo gives the substitute shape its colour
  let image;
  if (!modelFile && page.imageUrl) {
    const existing = ['jpg', 'png', 'webp'].map((e) => `${key}.${e}`).find((f) => existsSync(join(CACHE, f)));
    if (existing) image = existing;
    else {
      const img = await fetchProductImage(get, page.imageUrl);
      if (img.bytes) {
        image = `${key}.${img.ext}`;
        writeFileSync(join(CACHE, image), img.bytes);
      }
    }
  }
  const entry = mods.pageToCatalogEntry(page, modelFile);
  // dimensions missing (#269): the planner asks for them instead of dropping the product
  const draft = entry ? null : mods.pageToDraftEntry(page, modelFile);
  if (!entry && !draft) return [422, { error: 'Keine Produktdaten auf dieser Seite gefunden (ist es eine Produktseite?).' }];
  const found = entry ?? draft;
  if (!isIkea) found.id = key;
  const product = {
    article: found.articleNumber ?? key,
    entry,
    ...(draft ? { draft, reason: 'Maße fehlen auf der Seite' } : {}),
    model: modelFile ?? null,
    ...(image ? { image } : {}),
    ...(note ? { note } : {}),
  };
  const item = { id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`, receivedAt: new Date().toISOString(), product };
  inbox = [...inbox.filter((i) => i.product.article !== product.article), item].slice(-50);
  saveInbox();
  console.log(`Lesezeichen: ${found.name}${modelFile ? ' + Modell' : ''}${draft ? ' (Maße fehlen)' : ''}`);
  return [200, { name: found.name, model: !!modelFile, missingDims: !!draft, list: isIkea ? 'IKEA' : 'Möbelix' }];
}

/**
 * Receiving page of the bookmarklet: embedded by the shop page (or opened as a small window
 * where the shop forbids frames, e.g. Möbelix), it takes the page data via postMessage (only
 * from the shop origins) and posts it to /inbox on its own origin.
 */
const RECEIVER_PAGE = `<!doctype html><html lang="de"><meta charset="utf-8"><title>An Planer senden</title>
<style>body{margin:0;padding:12px 14px;font:14px system-ui,sans-serif;color:#111;background:#fff}b{color:#0058a3}</style>
<b>Wohnungsplaner</b><p id="s">Warte auf die Produktseite …</p>
<script>
const SHOPS = ${JSON.stringify(SHOP_ORIGINS)};
const show = (t) => (document.getElementById('s').textContent = t);
addEventListener('message', async (e) => {
  if (!SHOPS.includes(e.origin) || !e.data || e.data.type !== 'wp-send') return;
  show('Sende an den Planer …');
  let ok = false, text;
  try {
    const r = await fetch('/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e.data.payload) });
    const b = await r.json();
    ok = r.ok;
    text = ok
      ? '„' + b.name + '“ ist im Planer (Katalog › ' + (b.list === 'Möbelix' ? 'Möbelix' : 'IKEA') + ')' + (b.model ? ' – mit 3D-Modell' : '') + (b.missingDims ? '. Die Maße fehlen auf der Seite – bitte dort eintragen.' : '.')
      : b.error;
  } catch (err) {
    text = 'Fehler: ' + err;
  }
  show(text);
  e.source.postMessage({ type: 'wp-result', ok, text }, e.origin);
  if (opener && ok) setTimeout(() => close(), 4000);
});
const shop = opener || (parent !== window ? parent : null);
if (shop) shop.postMessage({ type: 'wp-ready' }, '*');
else show('Diese Seite öffnet das Lesezeichen „An Planer senden“ auf einer Produktseite.');
</script></html>`;

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/empfang') {
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `frame-ancestors ${SHOP_ORIGINS.join(' ')}`, 'cache-control': 'no-store' })
      .end(RECEIVER_PAGE);
    return;
  }
  if (!allowedOrigin(origin)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Nur für den lokal geöffneten Wohnungsplaner.');
    return;
  }
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-private-network': 'true',
      'access-control-max-age': '600',
    }).end();
    return;
  }
  const json = (status, body) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  try {
    if (req.method === 'POST' && url.pathname === '/inbox') {
      const [status, body] = await receivePage(JSON.parse(await readBody(req)));
      return json(status, body);
    }
    if (req.method === 'POST' && url.pathname === '/inbox/ack') {
      const ids = new Set((JSON.parse(await readBody(req))?.ids ?? []).map(String));
      inbox = inbox.filter((i) => !ids.has(i.id));
      saveInbox();
      return json(200, { ok: true });
    }
    if (req.method !== 'GET') return json(405, { error: 'Nur GET.' });
    if (url.pathname === '/bookmarklet') return json(200, { token: TOKEN });
    if (url.pathname === '/inbox') return json(200, { items: inbox });
    if (url.pathname === '/status') return json(200, { ok: true, name: 'wohnungsplaner-ikea-helper', version: VERSION });
    if (url.pathname === '/product') {
      const [status, body] = await product(url.searchParams);
      return json(status, body);
    }
    const img = url.pathname.match(/^\/image\/((?:s?\d{8}|mx[0-9a-f]{10})\.(jpg|png|webp))$/);
    if (img && existsSync(join(CACHE, img[1]))) {
      res.writeHead(200, { 'content-type': img[2] === 'jpg' ? 'image/jpeg' : `image/${img[2]}` }).end(readFileSync(join(CACHE, img[1])));
      return;
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
