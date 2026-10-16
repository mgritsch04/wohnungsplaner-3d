/**
 * IKEA article lists → planner product list. Shared by the browser app (tests) and
 * the local helper script `scripts/ikea-products.mjs`, which fetches the public
 * product pages for a short, user-supplied list of article numbers.
 */
import type { CatalogEntry } from '../catalogFormat';
import type { ParsedProductPage } from './structuredData';

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
 * Planner category from the German product name (heuristic, editable after import).
 * Order matters: "Schreibtisch" before "Tisch", "Bettsofa" counts as sofa.
 */
const CATEGORY_WORDS: [RegExp, string][] = [
  [/sofa|sessel|couch|récamiere|recamiere/i, 'sofa'],
  [/schreibtisch/i, 'desk'],
  [/bett(gestell)?\b|bettgestell|matratze/i, 'bed'],
  [/tisch/i, 'table'],
  [/stuhl|hocker|bank\b/i, 'chair'],
  [/lampe|leuchte|strahler/i, 'lighting'],
  [/teppich|gardine|vorhang|schals?\b/i, 'textile'],
  [/spüle|arbeitsplatte|küche|metod|unterschrank|oberschrank/i, 'kitchen'],
  [/kühlschrank|herd|backofen|geschirrspüler|dunstabzug|mikrowelle/i, 'appliance'],
  [/waschbecken|waschtisch|spiegelschrank|dusche/i, 'bathroom'],
  [/regal|schrank|kommode|aufbewahrung|vitrine|sideboard/i, 'storage'],
];

export function guessCategory(name: string): string {
  return CATEGORY_WORDS.find(([re]) => re.test(name))?.[1] ?? 'decor';
}

/**
 * Product list entry (units: cm) from a parsed product page. Returns null when the
 * page lacks complete dimensions or a name – nothing is guessed.
 */
export function pageToCatalogEntry(p: ParsedProductPage, modelFile?: string): CatalogEntry | null {
  const { width, depth, height } = p.dimensions;
  if (!width || !depth || !height || !p.name) return null;
  return {
    name: p.name,
    category: guessCategory(p.name),
    width,
    depth,
    height,
    price: p.price?.currency === 'EUR' ? p.price.amount : undefined,
    priceDate: p.retrievedAt.slice(0, 10),
    brand: p.brand ?? 'IKEA',
    retailer: 'IKEA Österreich',
    productUrl: p.productUrl ?? undefined,
    imageUrl: p.imageUrl ?? undefined,
    articleNumber: p.articleNumber ?? undefined,
    modelFile,
  };
}
