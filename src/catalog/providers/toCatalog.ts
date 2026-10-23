import type { CatalogItem } from '../types';
import { providerForUrl } from './registry';
import type { NormalizedProduct } from './types';

export interface CompletedProduct {
  product: NormalizedProduct;
  /** final values in cm (source or user-entered); all required */
  width: number;
  depth: number;
  height: number;
  name: string;
  category: string;
  shape: string;
  /** Pieces per pack when the page price is for a multipack (>= 2); absent = sold singly. */
  packSize?: number;
}

/** Turn a reviewed product into a catalog entry. Price status reflects its origin. */
export function productToCatalogItem(c: CompletedProduct): CatalogItem {
  const p = c.product;
  const provider = providerForUrl(p.productUrl);
  const sourceDims = p.dimensions.status.width === 'source' && p.dimensions.status.depth === 'source' && p.dimensions.status.height === 'source' &&
    p.dimensions.width === c.width && p.dimensions.depth === c.depth && p.dimensions.height === c.height;
  return {
    id: `prod-${p.provider}-${(p.articleNumber ?? p.sourceId ?? c.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    name: c.name,
    category: c.category,
    width: c.width / 100,
    depth: c.depth / 100,
    height: c.height / 100,
    color: '#b8b0a4',
    model: { type: 'procedural', shape: c.shape },
    price:
      p.price && p.price.currency === 'EUR'
        ? { amount: p.price.amount, currency: 'EUR', status: 'user', recordedAt: p.retrievedAt.slice(0, 10), ...(c.packSize && c.packSize > 1 ? { packSize: c.packSize } : {}) }
        : undefined,
    brand: p.brand ?? (provider.id === 'ikea-at' ? 'IKEA' : undefined),
    retailer: provider.id === 'generic' ? undefined : provider.label,
    productUrl: p.productUrl ?? undefined,
    imageUrl: p.imageUrl ?? undefined,
    approximate: true,
    solid: !['textile', 'lighting'].includes(c.category),
    tags: [p.articleNumber ?? '', sourceDims ? 'maße-aus-quelle' : 'maße-teilweise-manuell'].filter(Boolean),
    source: 'imported',
    sourceName: provider.label,
    description: `${sourceDims ? 'Maße aus der Produktseite übernommen' : 'Maße teilweise manuell eingegeben'} · Daten vom ${p.retrievedAt.slice(0, 10)}${p.availability ? ` · Verfügbarkeit laut Seite: ${p.availability}` : ''}`,
  };
}
