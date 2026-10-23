/**
 * Shared by `scripts/ikea-products.mjs` (command line) and `scripts/ikea-helper.mjs`
 * (local helper for the planner's IKEA section): fetch ONE public IKEA Austria product
 * page per article number, parse its schema.org data with the app's own parser and
 * optionally download the 3D model the page declares (web-api.ikea.com/dimma/assets –
 * allowed by robots.txt). At most one request every 1.5 s; no search, no accounts,
 * no internal IKEA APIs.
 */
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

export const DELAY_MS = 1500;
export const UA = 'wohnungsplaner-3d/0.1 (privates Planungswerkzeug; einzelne Produktseiten auf Nutzeranfrage)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Load the app's TypeScript parsers through Vite (no separate build step). */
export async function loadIkeaModules() {
  // the parser needs a DOM – provide jsdom's DOMParser in Node
  globalThis.DOMParser = new JSDOM('').window.DOMParser;
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  const list = await vite.ssrLoadModule('/src/catalog/providers/ikeaList.ts');
  const { parseProductPage } = await vite.ssrLoadModule('/src/catalog/providers/structuredData.ts');
  return { vite, ...list, parseProductPage };
}

/** Serialises outgoing requests so that at most one leaves every DELAY_MS. */
export function politeFetcher(delay = DELAY_MS) {
  let last = 0;
  let chain = Promise.resolve();
  return (url, init) => {
    const run = chain.then(async () => {
      const wait = last + delay - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fetch(url, init);
      } finally {
        last = Date.now();
      }
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** IKEA 3D models may only come from IKEA's asset host (allowed by robots.txt) – never from a URL a page claims elsewhere. */
export function isIkeaModelUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'web-api.ikea.com' && u.pathname.startsWith('/dimma/assets/');
  } catch {
    return false;
  }
}

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Download the product photo the sent page itself shows (#273: its main colour tints the
 * substitute 3D shape). Only https, only image types, at most 5 MB. Returns { bytes, ext } or a note.
 */
export async function fetchProductImage(get, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { bytes: null, note: 'Produktfoto: ungültige Adresse' };
  }
  if (u.protocol !== 'https:') return { bytes: null, note: 'Produktfoto: nur https' };
  // never a computer in the own network – the address comes from the sent page
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[|0\.)/i.test(u.hostname) || !u.hostname.includes('.'))
    return { bytes: null, note: 'Produktfoto: Adresse nicht erlaubt' };
  const res = await get(u.href, { headers: { 'user-agent': UA, accept: 'image/webp,image/jpeg,image/png' } });
  const ext = IMAGE_TYPES[(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()];
  if (!res.ok || !ext) return { bytes: null, note: `Produktfoto nicht geladen (HTTP ${res.status})` };
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) return { bytes: null, note: 'Produktfoto zu groß' };
  return { bytes, ext };
}

/** Download a declared IKEA 3D model; returns the bytes or a note why not. */
export async function fetchIkeaModel(get, url) {
  if (!isIkeaModelUrl(url)) return { bytes: null, note: 'Modell-Adresse ist keine IKEA-Modelldatei' };
  const m = await get(url, { headers: { 'user-agent': UA } });
  if (m.ok && /gltf-binary|octet-stream/.test(m.headers.get('content-type') ?? '')) return { bytes: Buffer.from(await m.arrayBuffer()) };
  return { bytes: null, note: `Modell nicht geladen (HTTP ${m.status})` };
}

/**
 * Fetch one article. Returns { article, entry | null, model: { file, bytes } | null, page, reason?, note? }.
 * `entry` is a product list entry (cm) or null when the page lacks a name or complete dimensions;
 * then `draft` carries what the page does state (pageToDraftEntry, #269).
 */
export async function fetchArticle(mods, get, a, { withModel }) {
  const article = mods.formatArticle(a);
  const res = await get(mods.ikeaProductUrl(a), { headers: { 'user-agent': UA, 'accept-language': 'de-AT' }, redirect: 'follow' });
  if (!res.ok) return { article, entry: null, model: null, reason: `HTTP ${res.status}` };
  const page = mods.parseProductPage(await res.text(), res.url);
  let model = null;
  let note;
  if (withModel && page.modelUrl) {
    const m = await fetchIkeaModel(get, page.modelUrl);
    if (m.bytes) model = { file: `${a.combination ? 's' : ''}${a.digits}.glb`, bytes: m.bytes };
    else note = m.note;
  }
  const entry = mods.pageToCatalogEntry(page, model?.file);
  if (!entry) {
    // name known, dimensions missing (#269): the planner asks for them instead of dropping the product
    const draft = mods.pageToDraftEntry(page, model?.file);
    return { article, entry: null, ...(draft ? { draft } : {}), model, page, reason: draft ? 'Maße fehlen auf der Seite – bitte im Planer unter Katalog › IKEA bzw. Möbelix › „Maße fehlen“ eintragen' : 'Name fehlt auf der Seite' };
  }
  return { article, entry, model, page, note };
}
