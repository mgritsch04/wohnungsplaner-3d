import { newId } from '../model/ids';
import type { Furniture } from '../model/schema';
import type { CatalogItem } from './types';

export function createFurnitureFromCatalog(item: CatalogItem, at: { x: number; y: number; rotation?: number }): Furniture {
  return {
    id: newId('item'),
    catalogId: item.id,
    name: item.name,
    category: item.category,
    x: at.x,
    y: at.y,
    elevation: item.elevation ?? 0,
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
