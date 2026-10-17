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
    ...retailerFields(p),
    productUrl: p.productUrl ?? undefined,
    imageUrl: p.imageUrl ?? undefined,
    articleNumber: p.articleNumber ?? undefined,
    modelFile,
  };
}
