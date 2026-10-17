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

/**
 * Chair under a table (#16): the seat may go under the table top, the backrest stops at the
 * table edge. Returns the depth (m) of the rear strip of a seat's footprint – its backrest –
 * that must stay clear of tables. The catalogue only stores bounding boxes, so the value comes
 * from the 3D model the app draws (`ProceduralModel.tsx`), where that is known:
 * - stool (no backrest): 0 – it may stand completely under the table;
 * - 'chair': 3.5 cm – backrest board (3 cm) and its posts (up to 3.5 cm from the rear edge);
 * - 'office-chair': 19 % of the depth – the backrest's front face lies at −0.62 × half the depth;
 * - anything else (imported models, unknown shapes): an assumed 20 % of the depth – about the
 *   share of the office chair, the larger of the two modelled backrests, so an unknown chair
 *   rather stops a little early than disappears in the table.
 */
export function seatBackDepth(f: Pick<Furniture, 'depth' | 'model'>): number {
  if (f.model.type === 'procedural') {
    if (f.model.shape === 'stool') return 0;
    if (f.model.shape === 'chair') return Math.min(0.035, f.depth);
    if (f.model.shape === 'office-chair') return 0.19 * f.depth;
  }
  return 0.2 * f.depth;
}

/** The seat and the table of a chair-under-table pair (in either order), or null. */
export function seatAndTable<T extends Item>(a: T, b: T): { seat: T; table: T } | null {
  if (isSeat(a) && isTableLike(b)) return { seat: a, table: b };
  if (isSeat(b) && isTableLike(a)) return { seat: b, table: a };
  return null;
}

export interface PairRule {
  allowed: boolean;
  /** why the overlap is fine (for tooltips/docs) */
  reason?: string;
}

/** May `a` and `b` overlap in plan and height? */
export function pairRule(a: Item, b: Item): PairRule {
  if (isTextile(a) || isTextile(b)) return { allowed: true, reason: 'Teppich/Vorhang' };
  // only the seat: the backrest must stay out of the table (`seatBackDepth`, checked in placement.ts)
  if (seatAndTable(a, b)) return { allowed: true, reason: 'Stuhl unter Tisch' };
  if ((a.kitchen || b.kitchen) && (isKitchenInsert(a) || isKitchenInsert(b))) return { allowed: true, reason: 'Kücheneinbau' };
  return { allowed: false };
}

/** Categories that never stand on other furniture, however small (stools stay under tables). */
const NOT_STACKABLE = new Set(['textile', 'chair', 'table', 'desk', 'sofa', 'bed', 'bathroom', 'kitchen']);
/** Shapes that hang, stand on the floor or on the wall even when small. */
const NOT_STACKABLE_SHAPES = new Set(['floor-lamp', 'pendant', 'panel', 'tv', 'curtain', 'rug', 'k-wall', 'k-hood', 'k-cooktop']);

/**
 * Small items that are put ON furniture (table lamps, decor, boxes, small appliances,
 * own or imported objects – #219): while dragging they stand on the surface below them
 * instead of colliding with it. Large furniture, seats, tables and built-in kitchen parts
 * stay on the floor.
 */
export function isStackable(f: Pick<Furniture, 'category' | 'width' | 'depth' | 'height' | 'model'> & { kitchen?: Furniture['kitchen'] }): boolean {
  const shape = shapeOf(f);
  if (shape === 'table-lamp') return true;
  if (f.kitchen || NOT_STACKABLE.has(f.category) || NOT_STACKABLE_SHAPES.has(shape)) return false;
  return Math.max(f.width, f.depth) <= 0.6 && f.height <= 0.8;
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
