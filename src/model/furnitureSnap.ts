/**
 * Snapping of a dragged furniture item to other furniture: edges and centres align
 * (flush against each other, side by side, centred) within a small distance (6 cm, a little more than the 5 cm grid step). Pure
 * functions on plan coordinates (metres). Wall snapping lives in `placement.ts`.
 */
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import type { Furniture, Project } from './schema';
import type { Vec2 } from './vec';

/** Snap distance in metres (> grid5 half-step plus float noise). */
export const FURNITURE_SNAP_DIST = 0.06;
/** Items further apart than this (perpendicular gap) do not attract each other. */
const MAX_GAP = 1.5;

export interface SnapGuide {
  a: Vec2;
  b: Vec2;
}

export interface FurnitureSnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function boxOf(f: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Box {
  const c = furnitureCorners(f);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function snappable(o: Furniture): boolean {
  return !(o.category === 'textile' && o.height < 0.05); // rugs lie under things
}

/**
 * Align the moving item `f` (at `goal`) to the nearest edge/centre of other furniture, per axis.
 * `axes` limits which axes may move (an axis already fixed by a wall stays untouched).
 */
export function snapToFurniture(
  d: Pick<Project, 'furniture'>,
  f: Furniture,
  goal: Vec2,
  axes: { x: boolean; y: boolean } = { x: true, y: true },
  dist = FURNITURE_SNAP_DIST,
): FurnitureSnapResult {
  const ob = d.furniture.filter((o) => o.id !== f.id && snappable(o)).map(boxOf);
  const m = boxOf({ ...f, x: goal.x, y: goal.y });
  const res: FurnitureSnapResult = { x: goal.x, y: goal.y, guides: [] };
  for (const axis of ['x', 'y'] as const) {
    if (!axes[axis]) continue;
    const lo = axis === 'x' ? 'x0' : 'y0';
    const hi = axis === 'x' ? 'x1' : 'y1';
    const plo = axis === 'x' ? 'y0' : 'x0'; // perpendicular span
    const phi = axis === 'x' ? 'y1' : 'x1';
    const mine = [m[lo], (m[lo] + m[hi]) / 2, m[hi]];
    let best: { delta: number; at: number; o: Box } | null = null;
    for (const o of ob) {
      const gap = Math.max(o[plo] - m[phi], m[plo] - o[phi], 0);
      if (gap > MAX_GAP) continue;
      for (const t of [o[lo], (o[lo] + o[hi]) / 2, o[hi]]) {
        for (const v of mine) {
          const delta = t - v;
          if (Math.abs(delta) <= dist && (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9)) best = { delta, at: t, o };
        }
      }
    }
    if (best) {
      res[axis] = goal[axis] + best.delta;
      const a = Math.min(m[plo], best.o[plo]);
      const b = Math.max(m[phi], best.o[phi]);
      res.guides.push(axis === 'x' ? { a: { x: best.at, y: a }, b: { x: best.at, y: b } } : { a: { x: a, y: best.at }, b: { x: b, y: best.at } });
    }
  }
  return res;
}
