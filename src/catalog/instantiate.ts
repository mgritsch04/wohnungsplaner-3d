import { newId } from '../model/ids';
import type { Furniture } from '../model/schema';
import type { CatalogItem } from './types';

/** Rim height of a washbasin above the floor (m). */
const BASIN_RIM = 0.85;

/**
 * Mounting height of an item without a stated elevation. A washbasin lower than a vanity unit
 * (wall-hung or countertop bowl, e.g. a found product) hangs with its rim at washbasin height
 * instead of lying on the floor.
 */
export function defaultElevation(item: Pick<CatalogItem, 'model' | 'height' | 'elevation'>): number {
  if (item.elevation !== undefined) return item.elevation;
  if (item.model.type === 'procedural' && item.model.shape === 'washbasin' && item.height < 0.6) return Math.max(0, Math.round((BASIN_RIM - item.height) * 1000) / 1000);
  return 0;
}

export function createFurnitureFromCatalog(item: CatalogItem, at: { x: number; y: number; rotation?: number }): Furniture {
  return {
    id: newId('item'),
    catalogId: item.id,
    name: item.name,
    category: item.category,
    x: at.x,
    y: at.y,
    elevation: defaultElevation(item),
    rotation: at.rotation ?? 0,
    width: item.width,
    depth: item.depth,
    height: item.height,
    color: item.color,
    model: structuredClone(item.model),
    quantity: 1,
    price: item.price ? { ...item.price } : undefined,
    brand: item.brand,
    retailer: item.retailer,
    productUrl: item.productUrl,
    imageUrl: item.imageUrl,
    approximate: item.approximate,
    solid: item.solid,
    kitchen: item.kitchen ? { ...item.kitchen } : undefined,
    locked: false,
    existing: false,
  };
}
