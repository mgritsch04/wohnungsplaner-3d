/**
 * IKEA article lists → planner product list. Shared by the browser app (tests) and
 * the local helper script `scripts/ikea-products.mjs`, which fetches the public
 * product pages for a short, user-supplied list of article numbers.
 */
import type { CatalogEntry } from '../catalogFormat';
import type { ParsedProductPage } from './structuredData';
import { classifyProduct } from './classify';
import { MOEBELIX_AT } from './registry';

export interface ArticleRef {
  /** 8 digits, without dots */
  digits: string;
  /** combination article ("S" prefix / s-number in URLs) */
  combination: boolean;
  quantity: number;
}

/**
 * Find IKEA article numbers in free text (one per line or mixed), e.g.
 * "104.099.32", "S895.792.19", "2 x 106.230.36", "10409932", or product URLs.
 * Duplicates are merged (quantities added).
 */
export function parseArticleList(text: string): ArticleRef[] {
  const out = new Map<string, ArticleRef>();
  const re = /(?:(\d{1,3})\s*[x×*]\s*)?(?:\/p\/[^\s"']*?-)?\b([sS]?)(\d{3})\.?(\d{3})\.?(\d{2})\b(?:\s*[x×*]\s*(\d{1,3})\b)?/g;
  for (const m of text.matchAll(re)) {
    const digits = m[3] + m[4] + m[5];
    const combination = m[2].toLowerCase() === 's';
    const quantity = Math.max(1, Math.min(999, Number(m[1] ?? m[6] ?? 1)));
    const key = (combination ? 's' : '') + digits;
    const prev = out.get(key);
    out.set(key, { digits, combination, quantity: (prev?.quantity ?? 0) + quantity });
  }
  return [...out.values()];
}

export const formatArticle = (a: Pick<ArticleRef, 'digits' | 'combination'>) =>
  `${a.combination ? 'S' : ''}${a.digits.slice(0, 3)}.${a.digits.slice(3, 6)}.${a.digits.slice(6)}`;

/**
 * Short product URL that IKEA redirects to the full product page (pattern taken
 * from IKEA's own planner configuration, verified for AT/de on 2026-10-16).
 */
export const ikeaProductUrl = (a: Pick<ArticleRef, 'digits' | 'combination'>, country = 'at', language = 'de') =>
  `https://www.ikea.com/${country}/${language}/p/-${a.combination ? 's' : ''}${a.digits}/`;

/**
 * Planner category from the German product name (shared word rules, editable after
 * import). Unknown types land in "Deko" so they stay visible in the list.
 */
export function guessCategory(name: string): string {
  return classifyProduct(name).category ?? 'decor';
}

/** Retailer and brand of a parsed page; IKEA unless the page belongs to Möbelix (bookmarklet, #221). */
function retailerFields(p: ParsedProductPage): { brand?: string; retailer: string } {
  if (p.provider === MOEBELIX_AT.id) return { brand: p.brand ?? undefined, retailer: MOEBELIX_AT.label };
  return { brand: p.brand ?? 'IKEA', retailer: 'IKEA Österreich' };
}

export type DimKey = 'width' | 'depth' | 'height';
export const DIM_KEYS: readonly DimKey[] = ['width', 'depth', 'height'];

/** A product whose page lacks some dimensions (#269): taken over once the user fills them in. */
export interface DraftEntry extends Omit<CatalogEntry, DimKey> {
  width: number | null;
  depth: number | null;
  height: number | null;
  missing: DimKey[];
}

/** Everything a product page states (units: cm), also when dimensions are missing. Null without a name. */
export function pageToDraftEntry(p: ParsedProductPage, modelFile?: string): DraftEntry | null {
  if (!p.name) return null;
  const kind = classifyProduct(p.name, p.categoryHints ?? []);
  const f = p.features ?? {};
  const shape = kind.shape === 'table' && f.round ? 'table-round' : kind.shape;
  const tableLike = shape === 'table' || shape === 'table-round' || shape === 'desk';
  const dim = (k: DimKey) => (p.dimensions[k] && p.dimensions[k]! > 0 ? p.dimensions[k] : null);
  return {
    name: p.name,
    // name and the page's own category labels (Möbelix breadcrumbs, #273) choose the substitute shape:
    // corner sofa, armchair, round table … instead of one box per category; plants (#269) keep their
    // 3D model's proportions, width/depth are the pot
    category: kind.category ?? 'decor',
    ...(shape ? { shape } : {}),
    // what the page text states about the build (#273); photo colours replace the colour words later
    ...(f.color ? { color: f.color } : {}),
    ...(f.secondaryColor ? { secondaryColor: f.secondaryColor } : {}),
    ...(tableLike && f.base ? { base: f.base } : {}),
    ...(tableLike && f.topThickness ? { topThickness: f.topThickness } : {}),
    ...(f.legSize ? { legSize: f.legSize } : {}),
    ...(f.seatHeight && (shape === 'chair' || shape === 'sofa' || shape === 'armchair') ? { seatHeight: f.seatHeight } : {}),
    width: dim('width'),
    depth: dim('depth'),
    height: dim('height'),
    missing: DIM_KEYS.filter((k) => dim(k) === null),
    price: p.price?.currency === 'EUR' ? p.price.amount : undefined,
    priceDate: p.retrievedAt.slice(0, 10),
    ...retailerFields(p),
    productUrl: p.productUrl ?? undefined,
    imageUrl: p.imageUrl ?? undefined,
    articleNumber: p.articleNumber ?? undefined,
    modelFile,
  };
}

/** The draft with the dimensions the user entered (cm); null while one is missing or not positive. */
export function completeDraft(d: DraftEntry, dims: Partial<Record<DimKey, number | null>>): CatalogEntry | null {
  const v = (k: DimKey) => {
    const x = dims[k] ?? d[k];
    return x !== null && Number.isFinite(x) && x > 0 ? x : null;
  };
  const width = v('width');
  const depth = v('depth');
  const height = v('height');
  if (width === null || depth === null || height === null) return null;
  const { missing: _missing, ...rest } = d;
  return { ...rest, width, depth, height };
}

/**
 * Product list entry (units: cm) from a parsed product page. Returns null when the
 * page lacks complete dimensions or a name – nothing is guessed (see pageToDraftEntry).
 */
export function pageToCatalogEntry(p: ParsedProductPage, modelFile?: string): CatalogEntry | null {
  const d = pageToDraftEntry(p, modelFile);
  return d && !d.missing.length ? completeDraft(d, {}) : null;
}
