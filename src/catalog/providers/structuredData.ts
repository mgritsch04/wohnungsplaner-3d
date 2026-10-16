import { providerForUrl } from './registry';
import type { FieldStatus, NormalizedProduct } from './types';

/**
 * Parse product data that the USER copied from a retailer page in their own browser.
 *
 * Accepted input (detected automatically):
 *  - `html`        page source ("Seitenquelltext anzeigen" → alles kopieren)
 *  - `jsonld`      a bare schema.org JSON-LD object/array
 *  - `json-simple` our minimal JSON: {"name","width","depth","height","price","currency","url","imageUrl"} (cm)
 *  - `text`        visible page text (only dimensions can be read reliably)
 *  - `url`         only an address – cannot be fetched from the browser (CORS); explained to the user
 *
 * Sources inside HTML, in priority order: schema.org JSON-LD, Open Graph / product meta tags,
 * microdata (itemprop), then dimension lines in the visible text and in embedded page data.
 * HTML is parsed with DOMParser, which never executes scripts. Nothing is fetched or guessed.
 */
export type InputKind = 'empty' | 'url' | 'html' | 'jsonld' | 'json-simple' | 'text' | 'invalid-json';

export interface ParsedProductPage extends NormalizedProduct {
  inputKind: InputKind;
  /** Problems the user can act on (shown prominently). */
  errors: string[];
  /** Which sources contributed data. */
  sources: string[];
  /** All 3D model files the page declares (schema.org 3DModel), in the page's order. */
  modelCandidates: string[];
}

export const MAX_INPUT_CHARS = 15_000_000;

type Json = Record<string, unknown>;

export function detectInputKind(input: string): InputKind {
  const t = input.trim();
  if (!t) return 'empty';
  if (/^https?:\/\/\S+$/i.test(t)) return 'url';
  if (/^[[{]/.test(t)) {
    try {
      const v = JSON.parse(t);
      const arr = Array.isArray(v) ? v : [v];
      if (arr.some((o) => o && typeof o === 'object' && ('@type' in o || '@graph' in o || '@context' in o))) return 'jsonld';
      if (arr.length === 1 && arr[0] && typeof arr[0] === 'object' && 'name' in arr[0]) return 'json-simple';
      return 'jsonld';
    } catch {
      return 'invalid-json';
    }
  }
  if (/<(html|head|body|script|meta|div|!doctype)\b/i.test(t)) return 'html';
  return 'text';
}

export function parseProductPage(input: string, pageUrl?: string): ParsedProductPage {
  const warnings: string[] = [];
  const errors: string[] = [];
  const sources: string[] = [];
  const kind = detectInputKind(input);
  if (input.length > MAX_INPUT_CHARS) errors.push(`Die Eingabe ist zu groß (${(input.length / 1e6).toFixed(1)} Mio. Zeichen, max. ${MAX_INPUT_CHARS / 1e6}).`);

  let products: Json[] = [];
  let meta: Partial<Record<'name' | 'image' | 'url' | 'price' | 'currency' | 'sku' | 'brand' | 'availability', string>> = {};
  let visibleText = '';
  let embeddedText = '';
  let simple: Json | null = null;
  let modelUrl: string | null = null;
  const models: string[] = [];

  if (kind === 'empty') errors.push('Bitte den Seitenquelltext oder JSON-Daten einfügen.');
  if (kind === 'url') {
    errors.push(
      'Es wurde nur eine Adresse eingefügt. Der Browser darf fremde Shopseiten aus Sicherheitsgründen (CORS) nicht selbst abrufen. Bitte die Seite öffnen, „Seitenquelltext anzeigen“ (Strg+U), alles markieren (Strg+A), kopieren und hier einfügen. Die Adresse gehört in das Feld „Produkt-URL“.',
    );
  }
  if (kind === 'invalid-json') errors.push(`Die Eingabe beginnt wie JSON, ist aber kein gültiges JSON (${jsonErrorText(input)}).`);
  if (kind === 'jsonld') {
    const r = parseJsonLdText(input, 'Eingabe');
    products = r.products;
    models.push(...r.models);
    errors.push(...r.errors);
    if (products.length) sources.push('JSON-LD');
  }
  if (kind === 'json-simple') {
    simple = JSON.parse(input.trim()) as Json;
    sources.push('JSON (einfaches Format)');
  }
  if (kind === 'html') {
    const doc = new DOMParser().parseFromString(input, 'text/html');
    const scripts = [...doc.querySelectorAll('script')];
    let block = 0;
    for (const s of scripts) {
      const type = (s.getAttribute('type') ?? '').toLowerCase().trim();
      const text = s.textContent ?? '';
      if (type === 'application/ld+json') {
        block++;
        const r = parseJsonLdText(text, `JSON-LD-Block ${block}`);
        products.push(...r.products);
        models.push(...r.models);
        errors.push(...r.errors);
      } else if (type === 'application/json' || type === '' || type === 'text/javascript' || type === 'module') {
        // embedded page state – used only as a secondary source for dimension lines
        embeddedText += ' ' + unescapeJsonText(text);
      }
    }
    if (products.length) sources.push('JSON-LD');
    if (!models.length) {
      // no standard declaration: look for other references (experimental heuristics)
      modelUrl = findModelUrl(doc, input);
      if (modelUrl) sources.push('3D-Modell-Verweis (experimentell)');
    }
    meta = readMeta(doc);
    if (Object.keys(meta).length) sources.push('Meta-Angaben');
    visibleText = visibleTextOf(doc);
    if (!products.length && block === 0 && !meta.name) {
      warnings.push('Keine strukturierten Produktdaten (JSON-LD/Meta) gefunden – nur Maßangaben aus dem Text werden gesucht.');
    }
  }
  if (kind === 'text') {
    visibleText = input.replace(/\s+/g, ' ');
    warnings.push('Das sieht nach sichtbarem Seitentext aus, nicht nach Quelltext. Name und Preis können so nicht sicher erkannt werden – für vollständige Daten den Seitenquelltext (Strg+U) einfügen.');
  }

  if (models.length) {
    // the page's own order; IKEA lists its preferred (Draco-compressed) variant first
    modelUrl = models[0];
    sources.push(`3D-Modell (schema.org 3DModel${models.length > 1 ? `, ${models.length} Varianten` : ''})`);
  }
  if (products.length > 1) warnings.push(`${products.length} Produkte in den strukturierten Daten – das erste wird verwendet.`);
  const p = products[0] ?? null;

  const url = pageUrl?.trim() || str(p?.url) || meta.url || str(simple?.url) || null;
  const provider = providerForUrl(url);
  let articleNumber: string | null = null;
  if (url && provider.articleNumberFromUrl) {
    try {
      articleNumber = provider.articleNumberFromUrl(new URL(url));
    } catch {
      /* invalid URL */
    }
  }
  const sku = str(p?.sku) ?? str(p?.productID) ?? str(p?.mpn) ?? meta.sku ?? null;
  if (!articleNumber && sku) articleNumber = sku;

  // price: JSON-LD offer → meta → simple JSON
  const offer = firstOffer(p?.offers);
  const spec = offer?.priceSpecification as Json | undefined;
  const priceRaw = offer ? (offer.price ?? offer.lowPrice ?? spec?.price) : undefined;
  let amount = priceRaw !== undefined && priceRaw !== null ? parseNumber(String(priceRaw)) : null;
  let currency = str(offer?.priceCurrency) ?? str(spec?.priceCurrency);
  if (amount === null && meta.price) {
    amount = parseNumber(meta.price);
    currency = currency ?? meta.currency ?? null;
  }
  if (amount === null && simple?.price !== undefined) {
    amount = parseNumber(String(simple.price));
    currency = str(simple.currency) ?? 'EUR';
  }
  const price = amount !== null && currency ? { amount, currency: currency.toUpperCase(), status: 'source' as FieldStatus } : null;
  if (amount !== null && !currency) warnings.push('Preis ohne Währungsangabe gefunden – nicht übernommen.');
  if (price && price.currency !== 'EUR') warnings.push(`Preis in ${price.currency}, nicht in EUR.`);

  // dimensions: structured → simple JSON → visible text → embedded page data
  const structured = dimsFromStructured(p);
  const fromSimple = simple ? { width: num(simple.width), depth: num(simple.depth), height: num(simple.height) } : {};
  const fromText = dimsFromText(visibleText);
  const fromEmbedded = dimsFromText(embeddedText);
  const pick = (k: 'width' | 'depth' | 'height') => structured[k] ?? fromSimple[k] ?? fromText[k] ?? fromEmbedded[k] ?? null;
  const dimensions = {
    width: pick('width'),
    depth: pick('depth'),
    height: pick('height'),
    status: { width: 'missing', depth: 'missing', height: 'missing' } as Record<'width' | 'depth' | 'height', FieldStatus>,
    sourceText: [fromText.sourceText, fromEmbedded.sourceText].filter(Boolean).join(' · ') || undefined,
  };
  for (const k of ['width', 'depth', 'height'] as const) dimensions.status[k] = dimensions[k] === null ? 'missing' : 'source';
  if (fromText.sourceText) sources.push('Maßangaben im Seitentext');
  else if (fromEmbedded.sourceText && (fromEmbedded.width ?? fromEmbedded.depth ?? fromEmbedded.height) !== null) sources.push('Maßangaben in eingebetteten Seitendaten');
  const missingDims = (['width', 'depth', 'height'] as const).filter((k) => dimensions[k] === null);
  if (missingDims.length && kind !== 'url' && kind !== 'empty') {
    warnings.push(`Maße nicht gefunden: ${missingDims.map((k) => ({ width: 'Breite', depth: 'Tiefe', height: 'Höhe' })[k]).join(', ')} – bitte selbst eintragen.`);
  }

  const imageFromLd = Array.isArray(p?.image) ? str(p?.image[0]) : (str((p?.image as Json)?.url) ?? str(p?.image));
  const image = imageFromLd ?? meta.image ?? str(simple?.imageUrl);
  const brand = str((p?.brand as Json)?.name) ?? str(p?.brand) ?? meta.brand ?? null;
  const name = str(p?.name) ?? meta.name ?? str(simple?.name) ?? null;
  const quality = name && price && missingDims.length === 0 ? 'complete-from-source' : name ? 'partial' : 'insufficient';
  return {
    provider: provider.id,
    sourceId: sku,
    articleNumber,
    name,
    brand,
    dimensions,
    price,
    productUrl: url && /^https?:\/\//i.test(url) ? url : null,
    imageUrl: image && /^https?:\/\//i.test(image) ? image : null,
    modelUrl: modelUrl ?? (str(simple?.modelUrl) && /^https:\/\//i.test(String(simple?.modelUrl)) ? String(simple?.modelUrl) : null),
    variant: str(p?.color) ?? null,
    availability: (str(offer?.availability) ?? meta.availability ?? null)?.replace(/^https?:\/\/schema\.org\//, '') ?? null,
    retrievedAt: new Date().toISOString(),
    quality,
    licenseNote: provider.licenseNote,
    warnings,
    inputKind: kind,
    errors,
    sources,
    modelCandidates: models,
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseNumber(v) : null;
  return n !== null && n !== undefined && n > 0 ? n : undefined;
};

function parseNumber(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!t) return null;
  // "1.299,00" → 1299 ; "1299.00" → 1299 ; "69,99" → 69.99
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function jsonErrorText(text: string): string {
  try {
    JSON.parse(text.trim());
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Parse JSON-LD text; tolerates HTML comments/CDATA wrappers and trailing commas. Reports errors. */
function parseJsonLdText(raw: string, label: string): { products: Json[]; models: string[]; errors: string[] } {
  const cleaned = raw
    .trim()
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .replace(/^\/\/\s*<!\[CDATA\[/, '')
    .replace(/\/\/\s*\]\]>$/, '')
    .trim();
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    try {
      value = JSON.parse(cleaned.replace(/,\s*([}\]])/g, '$1'));
    } catch (e) {
      return { products: [], models: [], errors: [`${label} ist fehlerhaftes JSON und wurde übersprungen (${e instanceof Error ? e.message : e}).`] };
    }
  }
  return { products: collectProducts(value), models: collectModels(value), errors: [] };
}

/**
 * glTF/GLB files declared as schema.org `3DModel` (`encoding[].contentUrl` with
 * `encodingFormat` model/gltf-binary or model/gltf+json). Verified on IKEA Austria
 * product pages (2026-10-16), which list several quality levels of the same model.
 */
function collectModels(root: unknown): string[] {
  const out: string[] = [];
  const isGltf = (fmt: unknown, url: string) => (typeof fmt === 'string' ? /gltf/i.test(fmt) : /\.(glb|gltf)(\?|$)/i.test(url));
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Json;
    if (typeNames(o).includes('3DModel')) {
      const enc = o.encoding;
      for (const e of (Array.isArray(enc) ? enc : enc ? [enc] : []) as Json[]) {
        const u = str(e?.contentUrl);
        if (u && /^https:\/\//i.test(u) && isGltf(e.encodingFormat, u)) out.push(u);
      }
      const direct = str(o.contentUrl);
      if (direct && /^https:\/\//i.test(direct) && isGltf(o.encodingFormat, direct)) out.push(direct);
    }
    if (o['@graph']) visit(o['@graph']);
    if (o.subjectOf) visit(o.subjectOf);
  };
  visit(root);
  return [...new Set(out)];
}

const typeNames = (o: Json): string[] => {
  const t = o['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^.*[/:#]/, ''));
};

function collectProducts(root: unknown): Json[] {
  const out: Json[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Json;
    const types = typeNames(o);
    if (types.includes('Product') || types.includes('ProductGroup') || types.includes('IndividualProduct')) out.push(o);
    if (o['@graph']) visit(o['@graph']);
    if (o.mainEntity) visit(o.mainEntity);
    if (types.includes('ProductGroup') && o.hasVariant) visit(o.hasVariant);
  };
  visit(root);
  // prefer concrete products over groups
  return out.sort((a, b) => Number(typeNames(a).includes('ProductGroup')) - Number(typeNames(b).includes('ProductGroup')));
}

/**
 * Reference to a 3D model in the page source. IKEA product pages with a "3D view"
 * reportedly embed `<script id="pip-xr-viewer-model">{"url": "…glb"}</script>`
 * (observed in third-party open-source code, UNVERIFIED against live pages).
 * Generic fallback: an https URL ending in .glb/.gltf anywhere in the source.
 */
export function findModelUrl(doc: Document, raw: string): string | null {
  const el = doc.getElementById('pip-xr-viewer-model');
  if (el?.textContent) {
    try {
      const v = JSON.parse(el.textContent) as Json;
      const u = str(v.url) ?? str((v.model as Json | undefined)?.url);
      if (u && /^https:\/\//i.test(u)) return u;
    } catch {
      /* fall through */
    }
  }
  const m = raw.replace(/\\\//g, '/').match(/https:\/\/[^\s"'<>()]+?\.(?:glb|gltf)(?:\?[^\s"'<>()]*)?(?=["'\s<)]|$)/i);
  return m ? m[0] : null;
}

/** Kept for the provider tests/API: products from HTML or JSON-LD text. */
export function extractJsonLdProducts(input: string): Json[] {
  const kind = detectInputKind(input);
  if (kind === 'jsonld') return parseJsonLdText(input, 'Eingabe').products;
  if (kind !== 'html') return [];
  const doc = new DOMParser().parseFromString(input, 'text/html');
  return [...doc.querySelectorAll('script')]
    .filter((s) => (s.getAttribute('type') ?? '').toLowerCase().trim() === 'application/ld+json')
    .flatMap((s) => parseJsonLdText(s.textContent ?? '', 'JSON-LD').products);
}

function readMeta(doc: Document): Partial<Record<'name' | 'image' | 'url' | 'price' | 'currency' | 'sku' | 'brand' | 'availability', string>> {
  const m = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() || undefined;
  const ip = (prop: string) => {
    const el = doc.querySelector(`[itemprop="${prop}"]`);
    if (!el) return undefined;
    return (el.getAttribute('content') ?? el.getAttribute('href') ?? el.textContent ?? '').trim() || undefined;
  };
  const out = {
    name: m('meta[property="og:title"]') ?? ip('name'),
    image: m('meta[property="og:image"]') ?? ip('image'),
    url: m('meta[property="og:url"]') ?? doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? undefined,
    price: m('meta[property="product:price:amount"]') ?? m('meta[property="og:price:amount"]') ?? ip('price'),
    currency: m('meta[property="product:price:currency"]') ?? m('meta[property="og:price:currency"]') ?? ip('priceCurrency'),
    sku: m('meta[property="product:retailer_item_id"]') ?? ip('sku'),
    brand: m('meta[property="product:brand"]') ?? m('meta[property="og:brand"]'),
    availability: m('meta[property="product:availability"]') ?? ip('availability'),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as typeof out;
}

function firstOffer(offers: unknown): Json | null {
  if (!offers) return null;
  if (Array.isArray(offers)) return (offers[0] as Json) ?? null;
  const o = offers as Json;
  if (typeNames(o).includes('AggregateOffer') && Array.isArray(o.offers)) return (o.offers[0] as Json) ?? o;
  return o;
}

/** schema.org QuantitativeValue (width/depth/height) → cm. Unknown units are not guessed. */
function dimsFromStructured(p: Json | null): { width?: number; depth?: number; height?: number } {
  if (!p) return {};
  const conv = (q: unknown): number | undefined => {
    if (q === null || q === undefined) return undefined;
    const qv = typeof q === 'object' ? (q as Json) : { value: q };
    const v = parseNumber(String(qv.value ?? ''));
    if (v === null) return undefined;
    const unit = String(qv.unitCode ?? qv.unitText ?? 'CMT').toUpperCase();
    if (unit === 'MMT' || unit === 'MM') return v / 10;
    if (unit === 'MTR' || unit === 'M') return v * 100;
    if (unit === 'CMT' || unit === 'CM') return v;
    return undefined;
  };
  const out: { width?: number; depth?: number; height?: number } = {};
  const w = conv(p.width);
  const d = conv(p.depth);
  const h = conv(p.height);
  if (w !== undefined) out.width = w;
  if (d !== undefined) out.depth = d;
  if (h !== undefined) out.height = h;
  return out;
}

export function htmlToText(html: string): string {
  return visibleTextOf(new DOMParser().parseFromString(html, 'text/html'));
}

/**
 * Visible text with a space between every text node. Using textContent alone would
 * glue neighbouring elements together ("80 cm</dd><dt>Tiefe" → "80 cmTiefe").
 */
function visibleTextOf(doc: Document): string {
  for (const el of doc.querySelectorAll('script,style,noscript,template')) el.remove();
  if (!doc.body) return '';
  const parts: string[] = [];
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '');
  return parts.join(' ').replace(/\s+/g, ' ');
}

/** Turn JSON-escaped page data into searchable text ("Höhe" → "Höhe"). */
function unescapeJsonText(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"')
    .replace(/["{}[\],]/g, ' ');
}

/**
 * Dimension lines, e.g. "Breite: 80 cm", "Gesamthöhe 202 cm", "B/T/H: 80 x 28 x 202 cm".
 * Unlabelled triples ("Maße: 200 x 90 x 82") are ignored – their order differs between shops.
 * Labels must not be part of a longer word: "Sitzhöhe"/"Sitztiefe" are NOT the product's height/depth.
 */
export function dimsFromText(text: string): { width: number | null; depth: number | null; height: number | null; sourceText?: string } {
  const val = (labels: string) => {
    const re = new RegExp(`(?<![\\p{L}])(?:gesamt-?)?(?:${labels})(?![\\p{L}])\\s*[:=]?\\s*(?:ca\\.?\\s*)?(\\d+(?:[.,]\\d+)?)\\s*(cm|mm|m)(?![\\p{L}])`, 'iu');
    const m = text.match(re);
    if (!m) return { v: null as number | null, src: '' };
    const n = parseNumber(m[1])!;
    const unit = m[2].toLowerCase();
    return { v: unit === 'mm' ? n / 10 : unit === 'm' ? n * 100 : n, src: m[0].trim() };
  };
  const w = val('breite|width');
  const d = val('tiefe|depth');
  const h = val('höhe|hoehe|height');
  let width = w.v;
  let depth = d.v;
  let height = h.v;
  const sources = [w.src, d.src, h.src].filter(Boolean);
  if (width === null && depth === null && height === null) {
    const m = text.match(/(?:B\s*\/\s*T\s*\/\s*H|B\s*x\s*T\s*x\s*H|BxTxH)\s*(?:\(cm\))?\s*:?\s*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?/i);
    if (m) {
      width = parseNumber(m[1]);
      depth = parseNumber(m[2]);
      height = parseNumber(m[3]);
      sources.push(m[0].trim());
    }
  }
  return { width, depth, height, sourceText: sources.length ? sources.join(' · ') : undefined };
}
