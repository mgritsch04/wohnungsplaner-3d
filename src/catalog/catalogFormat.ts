import { z } from 'zod';
import { FileFormatError, formatZodError } from '../formats/zodErrors';
import type { CatalogItem } from './types';
import { CATEGORIES } from './types';

/**
 * Product list import format ("wohnungsplaner-catalog").
 * Lets users bring real products (e.g. copied from IKEA Austria or Möbelix
 * product pages) into the planner without scraping. See docs/catalog-format.md.
 */
export const CATALOG_FORMAT = 'wohnungsplaner-catalog';

const num = z.number().refine(Number.isFinite);
const CatalogEntrySchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  category: z.string().default('decor'),
  width: num.positive(),
  depth: num.positive(),
  height: num.positive(),
  elevation: num.min(0).optional(),
  price: num.min(0).optional(),
  priceDate: z.string().max(40).optional(),
  brand: z.string().max(100).optional(),
  retailer: z.string().max(100).optional(),
  productUrl: z.string().max(2000).optional(),
  imageUrl: z.string().max(2000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  shape: z.string().max(40).optional(),
  modelUrl: z.string().max(2000).optional(),
  /** Name of a .glb file imported together with the list (no path). */
  modelFile: z.string().max(200).regex(/^[^/\\]+\.glb$/i, 'nur ein Dateiname mit Endung .glb').optional(),
  articleNumber: z.string().max(60).optional(),
});

export const CatalogFileSchema = z.object({
  format: z.literal(CATALOG_FORMAT),
  version: z.number().int().min(1).max(1),
  name: z.string().max(200).optional(),
  /** Unit of width/depth/height/elevation. */
  units: z.enum(['m', 'cm', 'mm']).default('cm'),
  items: z.array(CatalogEntrySchema).max(5000),
});

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

const DEFAULT_SHAPE: Record<string, string> = {
  sofa: 'sofa',
  bed: 'bed',
  table: 'table',
  chair: 'chair',
  storage: 'cabinet',
  desk: 'desk',
  lighting: 'floor-lamp',
  textile: 'rug',
  kitchen: 'k-base',
  appliance: 'box',
  bathroom: 'box',
  decor: 'box',
};

const isHttpUrl = (u?: string) => !!u && /^https?:\/\//i.test(u);

export function entriesToCatalogItems(entries: CatalogEntry[], units: 'm' | 'cm' | 'mm', sourceName: string): CatalogItem[] {
  const k = units === 'cm' ? 0.01 : units === 'mm' ? 0.001 : 1;
  const known = new Set<string>(CATEGORIES.map((c) => c.id));
  return entries.map((e, i) => {
    const category = known.has(e.category) ? e.category : 'decor';
    const shape = e.shape ?? DEFAULT_SHAPE[category] ?? 'box';
    return {
      id: `import-${slug(sourceName)}-${e.id ?? e.articleNumber ?? i}`,
      name: e.name,
      category,
      width: e.width * k,
      depth: e.depth * k,
      height: e.height * k,
      elevation: e.elevation !== undefined ? e.elevation * k : undefined,
      color: e.color ?? '#b8b0a4',
      model: isHttpUrl(e.modelUrl) ? { type: 'gltf', url: e.modelUrl, fallbackShape: shape } : { type: 'procedural', shape },
      price: e.price !== undefined ? { amount: e.price, currency: 'EUR', status: 'user', recordedAt: e.priceDate } : undefined,
      brand: e.brand,
      retailer: e.retailer,
      productUrl: isHttpUrl(e.productUrl) ? e.productUrl : undefined,
      imageUrl: isHttpUrl(e.imageUrl) ? e.imageUrl : undefined,
      approximate: !isHttpUrl(e.modelUrl),
      solid: !['textile', 'lighting'].includes(category),
      tags: [e.articleNumber ?? ''].filter(Boolean),
      source: 'imported',
      sourceName,
      ...(e.modelFile ? { modelFile: e.modelFile } : {}),
    } satisfies CatalogItem;
  });
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'katalog';
}

export function parseCatalogJson(text: string, fileName: string): CatalogItem[] {
  return parseCatalogJsonWithModels(text, fileName).items;
}

/** Raw product list entries (units as in the file; no conversion) – e.g. to look up names and prices by article number. */
export function parseCatalogEntries(text: string): { entries: CatalogEntry[]; units: 'm' | 'cm' | 'mm' } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new FileFormatError('Die Datei ist kein gültiges JSON.', [e instanceof Error ? e.message : String(e)]);
  }
  const res = CatalogFileSchema.safeParse(raw);
  if (!res.success) throw new FileFormatError('Die Produktliste ist ungültig.', formatZodError(res.error));
  return { entries: res.data.items, units: res.data.units };
}

/** Like parseCatalogJson, plus the `modelFile` names per catalog item id. */
export function parseCatalogJsonWithModels(text: string, fileName: string): { items: CatalogItem[]; modelFiles: Map<string, string> } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new FileFormatError('Die Datei ist kein gültiges JSON.', [e instanceof Error ? e.message : String(e)]);
  }
  const res = CatalogFileSchema.safeParse(raw);
  if (!res.success) throw new FileFormatError('Die Produktliste ist ungültig.', formatZodError(res.error));
  const items = entriesToCatalogItems(res.data.items, res.data.units, res.data.name ?? fileName);
  const modelFiles = new Map<string, string>();
  res.data.items.forEach((e, i) => e.modelFile && modelFiles.set(items[i].id, e.modelFile));
  return { items, modelFiles };
}

/** Minimal RFC-4180-style CSV parser supporting ; or , separators and quoted fields. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const CSV_COLUMNS: Record<string, keyof CatalogEntry | 'width_cm' | 'depth_cm' | 'height_cm'> = {
  name: 'name',
  bezeichnung: 'name',
  kategorie: 'category',
  category: 'category',
  breite_cm: 'width_cm',
  width_cm: 'width_cm',
  tiefe_cm: 'depth_cm',
  depth_cm: 'depth_cm',
  hoehe_cm: 'height_cm',
  höhe_cm: 'height_cm',
  height_cm: 'height_cm',
  preis_eur: 'price',
  price_eur: 'price',
  preisdatum: 'priceDate',
  price_date: 'priceDate',
  marke: 'brand',
  brand: 'brand',
  haendler: 'retailer',
  händler: 'retailer',
  retailer: 'retailer',
  url: 'productUrl',
  produkt_url: 'productUrl',
  product_url: 'productUrl',
  bild_url: 'imageUrl',
  image_url: 'imageUrl',
  farbe: 'color',
  color: 'color',
  form: 'shape',
  shape: 'shape',
  modell_url: 'modelUrl',
  model_url: 'modelUrl',
  artikelnummer: 'articleNumber',
  article_number: 'articleNumber',
};

export function parseCatalogCsv(text: string, fileName: string): { items: CatalogItem[]; errors: string[] } {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new FileFormatError('Die CSV-Datei enthält keine Datenzeilen.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const map = header.map((h) => CSV_COLUMNS[h]);
  for (const req of ['name', 'width_cm', 'depth_cm', 'height_cm'] as const) {
    if (!map.includes(req)) throw new FileFormatError(`Pflichtspalte fehlt: ${req === 'name' ? 'name' : req}`, ['Erwartete Spalten: name;kategorie;breite_cm;tiefe_cm;hoehe_cm;preis_eur;marke;haendler;url']);
  }
  const entries: CatalogEntry[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, idx) => {
    const obj: Record<string, unknown> = {};
    map.forEach((key, i) => {
      if (!key) return;
      const v = (r[i] ?? '').trim();
      if (v === '') return;
      if (key === 'width_cm' || key === 'depth_cm' || key === 'height_cm' || key === 'price') {
        obj[key === 'width_cm' ? 'width' : key === 'depth_cm' ? 'depth' : key === 'height_cm' ? 'height' : 'price'] = parseFloat(v.replace(/\s|€/g, '').replace(',', '.'));
      } else obj[key] = v;
    });
    const res = CatalogEntrySchema.safeParse(obj);
    if (res.success) entries.push(res.data);
    else errors.push(`Zeile ${idx + 2}: ${formatZodError(res.error, 2).join(', ')}`);
  });
  return { items: entriesToCatalogItems(entries, 'cm', fileName), errors };
}
