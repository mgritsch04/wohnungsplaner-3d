import { providerForUrl } from './registry';
import type { FieldStatus, NormalizedProduct } from './types';

/**
 * Parse product data from a pasted product page (HTML source or a bare JSON-LD
 * block) that the USER copied from their own browser. Reads schema.org
 * Product/Offer JSON-LD and German dimension lines ("Breite: 80 cm").
 * Nothing is fetched and nothing is guessed: missing values stay null.
 */
export function parseProductPage(input: string, pageUrl?: string): NormalizedProduct {
  const warnings: string[] = [];
  const products = extractJsonLdProducts(input);
  if (products.length > 1) warnings.push(`${products.length} Produkte in den strukturierten Daten – das erste wird verwendet.`);
  const p = products[0] ?? null;
  if (!p) warnings.push('Keine schema.org-Produktdaten (JSON-LD) gefunden.');

  const url = pageUrl?.trim() || str(p?.url) || null;
  const provider = providerForUrl(url);
  let articleNumber: string | null = null;
  if (url && provider.articleNumberFromUrl) {
    try {
      articleNumber = provider.articleNumberFromUrl(new URL(url));
    } catch {
      /* ignore invalid URL */
    }
  }
  const sku = str(p?.sku) ?? str(p?.productID) ?? str(p?.mpn);
  if (!articleNumber && sku) articleNumber = sku;

  const offer = firstOffer(p?.offers);
  const priceRaw = offer ? (offer.price ?? offer.lowPrice) : undefined;
  const amount = priceRaw !== undefined ? parseNumber(String(priceRaw)) : null;
  const currency = str(offer?.priceCurrency);
  const price = amount !== null && currency ? { amount, currency, status: 'source' as FieldStatus } : null;
  if (amount !== null && !currency) warnings.push('Preis ohne Währungsangabe – nicht übernommen.');
  if (price && price.currency !== 'EUR') warnings.push(`Preis in ${price.currency}, nicht in EUR.`);

  const dims = { ...dimsFromStructured(p), ...stripNull(dimsFromText(htmlToText(input))) };
  const status = (v: number | null): FieldStatus => (v === null ? 'missing' : 'source');
  const dimensions = {
    width: dims.width ?? null,
    depth: dims.depth ?? null,
    height: dims.height ?? null,
    status: { width: status(dims.width ?? null), depth: status(dims.depth ?? null), height: status(dims.height ?? null) },
    sourceText: dims.sourceText,
  };
  const missingDims = (['width', 'depth', 'height'] as const).filter((k) => dimensions[k] === null);
  if (missingDims.length) warnings.push(`Maße nicht in der Seite gefunden: ${missingDims.map((k) => ({ width: 'Breite', depth: 'Tiefe', height: 'Höhe' })[k]).join(', ')} – bitte selbst eintragen.`);

  const image = Array.isArray(p?.image) ? str(p?.image[0]) : str((p?.image as { url?: unknown })?.url) ?? str(p?.image);
  const brand = str((p?.brand as { name?: unknown })?.name) ?? str(p?.brand);
  const name = str(p?.name);
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
    modelUrl: null,
    variant: str(p?.color) ?? null,
    availability: str(offer?.availability)?.replace(/^https?:\/\/schema\.org\//, '') ?? null,
    retrievedAt: new Date().toISOString(),
    quality,
    licenseNote: provider.licenseNote,
    warnings,
  };
}

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

function parseNumber(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!t) return null;
  // "1.299,00" → 1299.00 ; "1299.00" → 1299 ; "69,99" → 69.99
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function stripNull<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}

export function extractJsonLdProducts(input: string): Json[] {
  const blocks: string[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) blocks.push(m[1]);
  if (blocks.length === 0 && /^\s*[[{]/.test(input)) blocks.push(input);
  const out: Json[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Json;
    const type = o['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes('Product') || types.includes('ProductGroup')) out.push(o);
    if (o['@graph']) visit(o['@graph']);
    if (types.includes('ProductGroup') && o.hasVariant) visit(o.hasVariant);
  };
  for (const b of blocks) {
    try {
      visit(JSON.parse(b.trim()));
    } catch {
      /* skip invalid block */
    }
  }
  // prefer concrete products over groups
  return out.sort((a, b) => Number(a['@type'] === 'ProductGroup') - Number(b['@type'] === 'ProductGroup'));
}

function firstOffer(offers: unknown): Json | null {
  if (!offers) return null;
  if (Array.isArray(offers)) return (offers[0] as Json) ?? null;
  const o = offers as Json;
  if (o['@type'] === 'AggregateOffer' && Array.isArray(o.offers)) return (o.offers[0] as Json) ?? o;
  return o;
}

/** schema.org QuantitativeValue (width/depth/height) → cm */
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
    return undefined; // unknown unit: do not guess
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
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** German/English dimension lines, e.g. "Breite: 80 cm", "Tiefe 28 cm", "Höhe: 202 cm", "B/T/H: 80 x 28 x 202 cm". */
export function dimsFromText(text: string): { width: number | null; depth: number | null; height: number | null; sourceText?: string } {
  const val = (labels: string) => {
    const re = new RegExp(`(?:${labels})\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s*(cm|mm|m)\\b`, 'i');
    const m = text.match(re);
    if (!m) return { v: null as number | null, src: '' };
    const n = parseNumber(m[1])!;
    const unit = m[2].toLowerCase();
    return { v: unit === 'mm' ? n / 10 : unit === 'm' ? n * 100 : n, src: m[0] };
  };
  const w = val('Breite|Width');
  const d = val('Tiefe|Depth');
  const h = val('Höhe|Hoehe|Height');
  let width = w.v;
  let depth = d.v;
  let height = h.v;
  const sources = [w.src, d.src, h.src].filter(Boolean);
  if (width === null && depth === null && height === null) {
    const m = text.match(/(?:B\s*\/\s*T\s*\/\s*H|BxTxH|Maße)\s*:?\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*cm/i);
    if (m) {
      width = parseNumber(m[1]);
      depth = parseNumber(m[2]);
      height = parseNumber(m[3]);
      sources.push(m[0]);
    }
  }
  return { width, depth, height, sourceText: sources.length ? sources.join(' · ') : undefined };
}
