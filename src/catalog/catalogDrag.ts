import { create } from 'zustand';
import type { DerivedPlan } from '../model/derived';
import { canDropAt, issueLevel, placeDroppedFurniture, placementIssues, type Obstacle } from '../model/placement';
import type { Furniture, Project } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { useCatalogStore } from './catalogStore';
import { findCatalogItem } from './generic';
import { createFurnitureFromCatalog } from './instantiate';
import type { CatalogItem } from './types';

/** Drag data type of a catalog entry dragged into the plan (#131). */
export const CATALOG_DRAG_TYPE = 'application/x-wohnungsplaner-catalog';

/**
 * The entry currently dragged out of the catalog panel. The drag data itself can only be read on
 * drop, so the 2D/3D previews of the item use this (same window, one drag at a time). Cleared on
 * dragend, which also fires when the drag is aborted with Esc or released outside the plan (#217).
 */
export const useCatalogDragStore = create<{ item: CatalogItem | null }>(() => ({ item: null }));

let blank: HTMLElement | null = null;
/** An invisible element as drag image: the plan and the 3D view show the item itself instead of the product photo (#217). */
function blankDragImage(): HTMLElement {
  if (!blank || !blank.isConnected) {
    blank = document.createElement('div');
    blank.style.cssText = 'position:fixed;top:-10px;left:-10px;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(blank);
  }
  return blank;
}

export function startCatalogDrag(dt: DataTransfer, item: CatalogItem) {
  useCatalogDragStore.setState({ item });
  dt.setData(CATALOG_DRAG_TYPE, item.id);
  dt.setData('text/plain', item.name);
  dt.effectAllowed = 'copy';
  if (typeof dt.setDragImage === 'function') dt.setDragImage(blankDragImage(), 0, 0);
}

export function endCatalogDrag() {
  useCatalogDragStore.setState({ item: null });
}

export function draggedCatalogItem(): CatalogItem | null {
  return useCatalogDragStore.getState().item;
}

export function isCatalogDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(CATALOG_DRAG_TYPE);
}

/** The catalog entry carried by a drop event, or null for anything else (files, text …). */
export function droppedCatalogItem(dt: DataTransfer | null): CatalogItem | null {
  const id = dt?.getData(CATALOG_DRAG_TYPE);
  if (!id) return null;
  const dragged = draggedCatalogItem();
  if (dragged?.id === id) return dragged;
  return findCatalogItem(id, useCatalogStore.getState().items) ?? null;
}

/** Preview of a dragged catalog entry (#217): the item as it would be placed, and whether the spot is free. */
export interface DropPreview {
  item: Furniture;
  /** ok = free; warn/error = placement conflict as for placed furniture; outside = not inside a room (rejected on drop). */
  level: 'ok' | 'warn' | 'error' | 'outside';
}

/** The same placement as on drop (snapping, Alt = free), on a shallow copy – the project is not changed. */
export function catalogDropPreview(project: Project, derived: DerivedPlan, obstacles: Obstacle[], item: CatalogItem, at: Vec2, altKey = false): DropPreview {
  const f = createFurnitureFromCatalog(item, at);
  if (!canDropAt(derived, at)) return { item: f, level: 'outside' };
  const p = { ...project, furniture: [...project.furniture] };
  placeDroppedFurniture(p, derived, f, at, altKey);
  const levels = placementIssues(p, derived, f, obstacles).map((i) => issueLevel(i.kind));
  return { item: f, level: levels.includes('error') ? 'error' : levels.includes('warn') ? 'warn' : 'ok' };
}
