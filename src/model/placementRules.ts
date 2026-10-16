/**
 * Which furniture may share space. One rule set used by every check (2D, 3D,
 * dragging, rotating, final placement), so warnings are consistent per type.
 *
 * Items whose footprints AND height ranges overlap conflict, unless the pair is a
 * known, intended combination. Items stacked on top of each other never overlap in
 * height, so "lamp on table" is fine as long as the lamp stands on the table top.
 * Geometry is the item's bounding box (also for imported 3D models).
 */
import type { Furniture } from './schema';

type Item = Pick<Furniture, 'category' | 'height' | 'elevation' | 'model' | 'kitchen' | 'name'>;

const shapeOf = (f: Pick<Furniture, 'model'>) => (f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape);

/** Rugs and curtains lie below / hang in front of other furniture. */
export const isRug = (f: Item) => f.category === 'textile' && f.height < 0.05;
export const isTextile = (f: Item) => f.category === 'textile';
const isSeat = (f: Item) => f.category === 'chair';
const isTableLike = (f: Item) => f.category === 'table' || f.category === 'desk';
const KITCHEN_INSERTS = new Set(['countertop', 'cooktop', 'hood']);
const isKitchenInsert = (f: Item) => !!f.kitchen && KITCHEN_INSERTS.has(f.kitchen.type);

export interface PairRule {
  allowed: boolean;
  /** why the overlap is fine (for tooltips/docs) */
  reason?: string;
}

/** May `a` and `b` overlap in plan and height? */
export function pairRule(a: Item, b: Item): PairRule {
  if (isTextile(a) || isTextile(b)) return { allowed: true, reason: 'Teppich/Vorhang' };
  if ((isSeat(a) && isTableLike(b)) || (isSeat(b) && isTableLike(a))) return { allowed: true, reason: 'Stuhl unter Tisch' };
  if ((a.kitchen || b.kitchen) && (isKitchenInsert(a) || isKitchenInsert(b))) return { allowed: true, reason: 'Kücheneinbau' };
  return { allowed: false };
}

/**
 * Small items that are put ON furniture (table lamps, small decor/plants): while
 * dragging they stand on the surface below them instead of colliding with it.
 */
export function isStackable(f: Pick<Furniture, 'category' | 'width' | 'depth' | 'height' | 'model'>): boolean {
  const shape = shapeOf(f);
  if (shape === 'table-lamp') return true;
  return (f.category === 'decor' || f.category === 'lighting') && shape !== 'floor-lamp' && shape !== 'pendant' && shape !== 'panel' && shape !== 'tv' && Math.max(f.width, f.depth) <= 0.6 && f.height <= 0.8;
}

/** Furniture that offers a top surface for stackable items. */
export function isSurface(f: Item): boolean {
  if (isTextile(f) || f.height > 1.3 || f.height < 0.2) return false;
  if (isTableLike(f)) return true;
  const shape = shapeOf(f);
  return ['cabinet', 'dresser', 'k-base', 'k-sink', 'washer', 'washbasin'].includes(shape) || (f.kitchen?.type === 'countertop');
}

/**
 * Furniture with doors/drawers on the front that needs free space to open.
 * Returns the required depth in metres (0 = no requirement).
 */
export function frontClearance(f: Item): number {
  if (f.kitchen) return ['base', 'tall', 'sink', 'oven', 'fridge', 'dishwasher'].includes(f.kitchen.type) ? 0.5 : 0;
  const shape = shapeOf(f);
  if (shape === 'wardrobe') return 0.6;
  if (shape === 'dresser') return 0.5;
  if (f.category === 'storage' && shape === 'cabinet') return 0.4;
  if (shape === 'washer' || shape === 'k-dishwasher' || shape === 'k-oven' || shape === 'k-fridge') return 0.5;
  return 0;
}
