import { neighbourLevel, planOfLevel, storeyHeight } from './levels';
import type { Furniture, Project } from './schema';
import { add, polygonArea, rotate, signedArea, sub, type Vec2 } from './vec';

/**
 * Stairs between storeys (#54). A stair is a piece of furniture with the procedural shape
 * `stairs`: a straight flight that rises from its front (local +y) to its back (local −y) by its
 * height. It is not solid: the walkthrough walks up its slope and changes to the storey above at
 * the top. A stair that reaches the storey above cuts its footprint out of that storey's floor
 * and out of its own storey's ceiling.
 */
export const STAIR_SHAPE = 'stairs';
/** Comfortable rise of one step (m); the number of steps follows from the height. */
export const STEP_RISE = 0.18;
/** A stair "reaches" the storey above when its top is this close to that floor (m). */
const REACH_TOLERANCE = 0.35;

export function isStair(f: Pick<Furniture, 'model'>): boolean {
  return (f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape) === STAIR_SHAPE;
}

export function stepCount(height: number): number {
  return Math.max(2, Math.round(height / STEP_RISE));
}

function local(f: Pick<Furniture, 'x' | 'y' | 'rotation'>, p: Vec2): Vec2 {
  return rotate(sub(p, { x: f.x, y: f.y }), -f.rotation);
}

/** Footprint corners of a stair in plan coordinates. */
export function stairFootprint(f: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Vec2[] {
  const hw = f.width / 2;
  const hd = f.depth / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((c) => add({ x: f.x, y: f.y }, rotate(c, f.rotation)));
}

/**
 * Height of the walking surface of a stair at plan point `p`, measured from the stair's floor
 * (a smooth slope instead of single steps, so walking feels even); null outside the stair.
 */
export function stairSurfaceAt(f: Furniture, p: Vec2): number | null {
  const q = local(f, p);
  if (Math.abs(q.x) > f.width / 2 || Math.abs(q.y) > f.depth / 2) return null;
  const t = (f.depth / 2 - q.y) / f.depth;
  return f.elevation + Math.min(1, Math.max(0, t)) * f.height;
}

/** Whether a stair standing on a storey leads up to the floor `rise` metres above it. */
export function reachesAbove(f: Furniture, rise: number): boolean {
  return isStair(f) && Math.abs(f.elevation + f.height - rise) <= REACH_TOLERANCE;
}

/** Stairs of the storey below that lead up to `levelId`, with the height difference. */
export function stairsFromBelow(p: Project, levelId = p.activeLevelId): { stairs: Furniture[]; rise: number } {
  const below = neighbourLevel(p, -1, levelId);
  const here = p.levels.find((l) => l.id === levelId);
  if (!below || !here) return { stairs: [], rise: 0 };
  const rise = here.elevation - below.elevation;
  return { stairs: planOfLevel(p, below.id).furniture.filter((f) => reachesAbove(f, rise)), rise };
}

/** Stairs of a storey that lead up to the storey above it. */
export function stairsUp(p: Project, levelId = p.activeLevelId): Furniture[] {
  const above = neighbourLevel(p, 1, levelId);
  const here = p.levels.find((l) => l.id === levelId);
  if (!above || !here) return [];
  const rise = above.elevation - here.elevation;
  return planOfLevel(p, levelId).furniture.filter((f) => reachesAbove(f, rise));
}

/** Openings a storey needs (plan polygons): in its floor for stairs coming up, in its ceiling for stairs going up. */
export function stairwells(p: Project, levelId = p.activeLevelId): { floor: Vec2[][]; ceiling: Vec2[][] } {
  return { floor: stairsFromBelow(p, levelId).stairs.map(stairFootprint), ceiling: stairsUp(p, levelId).map(stairFootprint) };
}

/**
 * Height of the ground under the walker on the active storey (m, relative to its floor): the
 * slope of a stair standing here, or – in the stairwell of a stair coming up from below – the
 * part of that stair below this floor (negative). 0 elsewhere.
 */
export function walkGroundAt(p: Project, pt: Vec2): number {
  const below = stairsFromBelow(p);
  for (const s of below.stairs) {
    const h = stairSurfaceAt(s, pt);
    if (h !== null) return h - below.rise;
  }
  let g = 0;
  for (const f of p.furniture) {
    if (!isStair(f)) continue;
    const h = stairSurfaceAt(f, pt);
    if (h !== null && h > g) g = h;
  }
  return g;
}

/** Height a new stair gets on the active storey: up to the storey above, else the storey height. */
export function defaultStairHeight(p: Project): number {
  return Math.round(storeyHeight(p, p.activeLevelId) * 1000) / 1000;
}

/**
 * The part of a stairwell (convex) that lies in a room, pulled 2 mm inwards so it is a clean hole
 * inside the room's floor or ceiling polygon; null when they hardly overlap. A stair along a wall
 * reaches into the wall – that part is simply not cut.
 */
export function holeInRoom(room: Vec2[], well: Vec2[]): Vec2[] | null {
  const ccw = signedArea(well) > 0;
  let poly = room;
  for (let i = 0; i < well.length && poly.length >= 3; i++) {
    const a = well[i];
    const b = well[(i + 1) % well.length];
    // inside = left of a→b for a counter-clockwise well
    const side = (p: Vec2) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) * (ccw ? 1 : -1);
    const out: Vec2[] = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j];
      const q = poly[(j + 1) % poly.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    poly = out;
  }
  if (poly.length < 3 || polygonArea(poly) < 0.01) return null;
  const c = poly.reduce((s, p) => add(s, p), { x: 0, y: 0 });
  const center = { x: c.x / poly.length, y: c.y / poly.length };
  return poly.map((p) => {
    const d = sub(p, center);
    const len = Math.hypot(d.x, d.y);
    return len < 0.004 ? p : add(center, { x: d.x * (1 - 0.002 / len), y: d.y * (1 - 0.002 / len) });
  });
}
