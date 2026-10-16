import { useCatalogStore } from './catalogStore';
import { findCatalogItem } from './generic';
import type { CatalogItem } from './types';

/** Drag data type of a catalog entry dragged into the plan (#131). */
export const CATALOG_DRAG_TYPE = 'application/x-wohnungsplaner-catalog';

/**
 * The entry currently dragged out of the catalog panel. The drag data itself can only be read on
 * drop, so the 2D preview of the footprint uses this (same window, one drag at a time).
 */
let dragged: CatalogItem | null = null;

export function startCatalogDrag(dt: DataTransfer, item: CatalogItem) {
  dragged = item;
  dt.setData(CATALOG_DRAG_TYPE, item.id);
  dt.setData('text/plain', item.name);
  dt.effectAllowed = 'copy';
}

export function endCatalogDrag() {
  dragged = null;
}

export function draggedCatalogItem(): CatalogItem | null {
  return dragged;
}

export function isCatalogDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(CATALOG_DRAG_TYPE);
}

/** The catalog entry carried by a drop event, or null for anything else (files, text …). */
export function droppedCatalogItem(dt: DataTransfer | null): CatalogItem | null {
  const id = dt?.getData(CATALOG_DRAG_TYPE);
  if (!id) return null;
  if (dragged?.id === id) return dragged;
  return findCatalogItem(id, useCatalogStore.getState().items) ?? null;
}
