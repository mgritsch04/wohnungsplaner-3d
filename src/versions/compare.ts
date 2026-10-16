import { computeBudget } from '../budget/budget';
import { derivePlan } from '../model/derived';
import { isRug } from '../model/placementRules';
import type { Furniture, Project } from '../model/schema';
import { boundsOf, pointInPolygon, rotate, sub, type Vec2 } from '../model/vec';

/**
 * Key figures of one variant (#58): price from the budget, furniture count and
 * occupied / free floor area per room (room area from derivePlan()).
 *
 * Occupied floor = union of the footprints of furniture standing on the floor
 * (base below 5 cm), without rugs, clipped to the room's interior outline.
 * Overlaps (chair under table) count once. The union is measured on a fine grid
 * (≤ ~20 000 samples per room), i.e. accurate to well below 0.1 m² for rooms.
 */

export interface RoomUsage {
  roomId: string;
  name: string;
  /** Net floor area (m²) as shown in the plan. */
  area: number;
  occupied: number;
  free: number;
}

export interface VariantSummary {
  /** Sum of all known prices (EUR). */
  totalPrice: number;
  /** Items without a price (not included in totalPrice). */
  missingPrices: number;
  /** Furniture pieces (quantities summed, like the budget). */
  pieces: number;
  /** Furniture objects in the plan. */
  objects: number;
  rooms: RoomUsage[];
  area: number;
  occupied: number;
  free: number;
}

const FLOOR_TOLERANCE = 0.05;
const MAX_SAMPLES = 20000;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Furniture that covers floor space. */
export function occupiesFloor(f: Furniture): boolean {
  return f.elevation < FLOOR_TOLERANCE && !isRug(f);
}

function insideFootprint(f: Furniture, p: Vec2): boolean {
  const l = rotate(sub(p, f), -f.rotation);
  return Math.abs(l.x) <= f.width / 2 && Math.abs(l.y) <= f.depth / 2;
}

/** Occupied share (0..1) of a polygon, measured on a regular grid. */
export function occupiedFraction(interior: Vec2[], items: Furniture[]): number {
  const b = boundsOf(interior);
  if (!b || items.length === 0) return 0;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (w <= 0 || h <= 0) return 0;
  const step = Math.max(0.01, Math.sqrt((w * h) / MAX_SAMPLES));
  // only items whose bounding circle reaches the room
  const near = items.filter((f) => {
    const r = Math.hypot(f.width, f.depth) / 2;
    return f.x + r >= b.minX && f.x - r <= b.maxX && f.y + r >= b.minY && f.y - r <= b.maxY;
  });
  if (!near.length) return 0;
  let inside = 0;
  let covered = 0;
  for (let y = b.minY + step / 2; y < b.maxY; y += step) {
    for (let x = b.minX + step / 2; x < b.maxX; x += step) {
      const p = { x, y };
      if (!pointInPolygon(p, interior)) continue;
      inside++;
      if (near.some((f) => insideFootprint(f, p))) covered++;
    }
  }
  return inside ? covered / inside : 0;
}

export function summarizeVariant(p: Project): VariantSummary {
  const budget = computeBudget(p.furniture);
  const derived = derivePlan(p);
  const floorItems = p.furniture.filter(occupiesFloor);
  const rooms: RoomUsage[] = [];
  for (const r of p.rooms) {
    const g = derived.rooms.get(r.id);
    if (!g) continue;
    const occupied = Math.min(g.area, g.area * occupiedFraction(g.interior, floorItems));
    rooms.push({ roomId: r.id, name: r.name, area: round2(g.area), occupied: round2(occupied), free: round2(g.area - occupied) });
  }
  const sum = (k: 'area' | 'occupied' | 'free') => round2(rooms.reduce((s, r) => s + r[k], 0));
  return {
    totalPrice: budget.total,
    missingPrices: budget.missingCount,
    pieces: budget.lines.reduce((s, l) => s + l.quantity, 0),
    objects: p.furniture.length,
    rooms,
    area: sum('area'),
    occupied: sum('occupied'),
    free: sum('free'),
  };
}

export interface RoomComparison {
  name: string;
  a: RoomUsage | null;
  b: RoomUsage | null;
}

/** Pair the rooms of two variants: same room id first, then same name. */
export function pairRooms(a: VariantSummary, b: VariantSummary): RoomComparison[] {
  const rest = [...b.rooms];
  const take = (pred: (r: RoomUsage) => boolean) => {
    const i = rest.findIndex(pred);
    return i < 0 ? null : rest.splice(i, 1)[0];
  };
  const out: RoomComparison[] = a.rooms.map((ra) => ({ name: ra.name, a: ra, b: take((r) => r.roomId === ra.roomId) }));
  for (const row of out) if (!row.b) row.b = take((r) => r.name === row.name);
  for (const rb of rest) out.push({ name: rb.name, a: null, b: rb });
  return out;
}
