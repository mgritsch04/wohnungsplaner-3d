/**
 * Clearances while placing furniture (#50)
 * ----------------------------------------
 * For one furniture item: the free distance in the four axis directions of its
 * (possibly rotated) footprint – left (local -x), right (+x), back (-y) and
 * front (+y) – to the nearest wall face or other furniture footprint.
 *
 * "Distance in a direction" means: how far the item could be moved straight in
 * that direction before its footprint touches something. Only obstacles within
 * the strip swept by the item's edge count (the strip is shrunk by 1 mm on both
 * sides, so a wall the item stands flush against with its side does not block
 * the front/back measurement). This works for rotated items and slanted walls:
 * every obstacle polygon is taken into the item's local frame, clipped to the
 * strip, and its nearest point ahead of the edge is the hit.
 *
 * Obstacles (same idea as collision and narrow passages):
 * - wall pieces (openings cut out) and junction fills whose height range overlaps
 *   the item's – a low sideboard sees the wall below a window sill, a door
 *   opening lets the measurement pass through;
 * - other furniture whose height range overlaps the item's. Rugs, curtains and
 *   other textiles and flat parts (< 5 cm) do not count. A dragged textile only
 *   measures to walls (furniture stands on rugs).
 * - Furniture whose footprint overlaps the item is skipped (intended overlaps such
 *   as chair under table, or a conflict that is marked separately).
 *
 * Results below `minDistance` (touching, default 5 mm) or above `maxDistance`
 * (default 3 m) and directions without a hit are left out.
 */
import { footprintsOverlap, furnitureCorners } from '../editor2d/furnitureGeometry';
import type { DerivedPlan } from './derived';
import { isTextile } from './placementRules';
import type { Furniture, Project } from './schema';
import { add, closestPointOnSegment, dist, normalize, perp, rotate, scale, sub, type Vec2 } from './vec';

export type ClearanceSide = 'left' | 'right' | 'back' | 'front';

export interface Clearance {
  side: ClearanceSide;
  /** Point on the item's edge where the dimension line starts (plan metres). */
  from: Vec2;
  /** Point where it hits the obstacle. */
  to: Vec2;
  /** Free distance in metres. */
  distance: number;
  /** What was hit: a wall (id of the wall, or of the junction node for a junction fill) or furniture. */
  hit: { type: 'wall' | 'furniture'; id: string };
}

export interface ClearanceOptions {
  /** Longer distances are omitted (m). Default 3. */
  maxDistance?: number;
  /** Shorter distances count as touching and are omitted (m). Default 0.005. */
  minDistance?: number;
}

export const CLEARANCE_MAX = 3;
export const CLEARANCE_MIN = 0.005;
/** The strip is shrunk by this much on both sides (m). */
const SIDE_EPS = 0.001;
/** Lateral tolerance for "same hit distance" when locating the line. */
const TIE = 1e-4;

/** Obstacles below this height are flat (rugs, mats) and never block. */
const FLAT = 0.05;

interface Candidate {
  polygon: Vec2[];
  z0: number;
  z1: number;
  type: 'wall' | 'furniture';
  id: string;
}

// direction table: axis 0 = local x (width), 1 = local y (depth); sign of the direction
const SIDES: { side: ClearanceSide; axis: 0 | 1; sign: 1 | -1 }[] = [
  { side: 'left', axis: 0, sign: -1 },
  { side: 'right', axis: 0, sign: 1 },
  { side: 'back', axis: 1, sign: -1 },
  { side: 'front', axis: 1, sign: 1 },
];

interface Best {
  d: number;
  bMin: number;
  bMax: number;
  hit: Candidate | null;
}

/**
 * Clip the polygon (local coordinates in xs/ys) to the strip |b| < half, where b is the
 * lateral coordinate, and update `best` with the nearest point ahead (coordinate a ≥ ha).
 * Sutherland–Hodgman against the two strip borders, done inline (hot path while dragging).
 */
function sweep(xs: number[], ys: number[], axis: 0 | 1, sign: number, ha: number, half: number, best: Best, c: Candidate, max: number) {
  const n = xs.length;
  // a = coordinate along the direction, b = lateral coordinate
  let A: number[] = new Array(n);
  let B: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    A[i] = sign * (axis === 0 ? xs[i] : ys[i]);
    B[i] = axis === 0 ? ys[i] : xs[i];
  }
  for (const lim of [half, -half]) {
    // keep the side b*s ≤ half (s = sign of lim)
    const s = lim > 0 ? 1 : -1;
    const oa: number[] = [];
    const ob: number[] = [];
    const m = A.length;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const pi = B[i] * s <= half;
      const pj = B[j] * s <= half;
      if (pi) {
        oa.push(A[i]);
        ob.push(B[i]);
      }
      if (pi !== pj) {
        const t = (lim - B[i]) / (B[j] - B[i]);
        oa.push(A[i] + (A[j] - A[i]) * t);
        ob.push(lim);
      }
    }
    A = oa;
    B = ob;
    if (A.length === 0) return;
  }
  let aMin = Infinity;
  let aMax = -Infinity;
  for (const a of A) {
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
  }
  // entirely behind the leading edge (beside or behind the item)
  if (aMax <= ha + 1e-9) return;
  const d = Math.max(0, aMin - ha);
  if (d > max || d > best.d + TIE) return;
  // lateral range of the nearest part (a whole edge for a parallel wall, else one point)
  let bMin = Infinity;
  let bMax = -Infinity;
  for (let i = 0; i < A.length; i++) {
    if (A[i] <= aMin + TIE) {
      if (B[i] < bMin) bMin = B[i];
      if (B[i] > bMax) bMax = B[i];
    }
  }
  if (d < best.d - TIE || !best.hit) {
    best.d = d;
    best.bMin = bMin;
    best.bMax = bMax;
    best.hit = c;
  } else {
    // equally near (e.g. pieces of one wall split by a window): merge the ranges
    best.bMin = Math.min(best.bMin, bMin);
    best.bMax = Math.max(best.bMax, bMax);
  }
}

function candidates(project: Project, derived: DerivedPlan, item: Furniture): Candidate[] {
  const out: Candidate[] = [];
  for (const [wallId, pieces] of derived.pieces) for (const pc of pieces) out.push({ polygon: pc.polygon, z0: pc.z0, z1: pc.z1, type: 'wall', id: wallId });
  for (const h of derived.hubs) out.push({ polygon: h.polygon, z0: 0, z1: h.height, type: 'wall', id: h.nodeId });
  if (isTextile(item)) return out;
  for (const o of project.furniture) {
    if (o.id === item.id || isTextile(o) || o.height < FLAT) continue;
    out.push({ polygon: furnitureCorners(o), z0: o.elevation, z1: o.elevation + o.height, type: 'furniture', id: o.id });
  }
  return out;
}

/** Free distances of one furniture item in its four axis directions (see module comment). */
export function furnitureClearances(project: Project, derived: DerivedPlan, furnitureId: string, opts: ClearanceOptions = {}): Clearance[] {
  const item = project.furniture.find((f) => f.id === furnitureId);
  if (!item) return [];
  const max = opts.maxDistance ?? CLEARANCE_MAX;
  const min = opts.minDistance ?? CLEARANCE_MIN;
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  const z0 = item.elevation;
  const z1 = item.elevation + item.height;
  const reach = max + Math.hypot(hw, hd);
  const corners = furnitureCorners(item);

  const best: Best[] = SIDES.map(() => ({ d: Infinity, bMin: 0, bMax: 0, hit: null }));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of candidates(project, derived, item)) {
    // height ranges must overlap (a wall cabinet does not block a sofa below it)
    if (Math.min(z1, c.z1) - Math.max(z0, c.z0) <= 0.005) continue;
    // to local coordinates; cheap reject when the whole polygon is out of reach
    xs.length = 0;
    ys.length = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of c.polygon) {
      const dx = p.x - item.x;
      const dy = p.y - item.y;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      xs.push(lx);
      ys.push(ly);
      if (lx < minX) minX = lx;
      if (lx > maxX) maxX = lx;
      if (ly < minY) minY = ly;
      if (ly > maxY) maxY = ly;
    }
    if (maxX < -reach || minX > reach || maxY < -reach || minY > reach) continue;
    // other furniture overlapping the item: intended (chair under table) or marked as conflict
    if (c.type === 'furniture' && footprintsOverlap(corners, c.polygon, 1e-3)) continue;
    for (let k = 0; k < SIDES.length; k++) {
      const s = SIDES[k];
      const ha = s.axis === 0 ? hw : hd;
      const hb = s.axis === 0 ? hd : hw;
      sweep(xs, ys, s.axis, s.sign, ha, hb - SIDE_EPS, best[k], c, max);
    }
  }

  const out: Clearance[] = [];
  const toWorld = (lx: number, ly: number): Vec2 => ({ x: item.x + lx * cos - ly * sin, y: item.y + lx * sin + ly * cos });
  for (let k = 0; k < SIDES.length; k++) {
    const b = best[k];
    if (!b.hit || b.d < min || b.d > max) continue;
    const s = SIDES[k];
    const ha = s.axis === 0 ? hw : hd;
    // draw the line from the middle of the edge if the hit spans it, else at the nearest point
    const lat = Math.max(b.bMin, Math.min(b.bMax, 0));
    const at = (a: number): Vec2 => (s.axis === 0 ? toWorld(s.sign * a, lat) : toWorld(lat, s.sign * a));
    out.push({ side: s.side, from: at(ha), to: at(ha + b.d), distance: b.d, hit: { type: b.hit.type, id: b.hit.id } });
  }
  return out;
}

/** "42 cm" – label of a clearance, rounded to whole centimetres. */
export function clearanceLabel(distance: number): string {
  return `${Math.round(distance * 100)} cm`;
}

/** Screen size of a clearance label (px): ~0.6 em per character at 11 px plus halo/padding. */
export const labelWidthPx = (text: string) => text.length * 6.6 + 6;
/** Distance (px) kept between a dimension line and the rotate handle. */
const HANDLE_CLEAR_PX = 10;
/** Parallel shift (px) of a line that would run through the rotate handle. */
const HANDLE_SHIFT_PX = 14;

export interface ClearanceLayout {
  /** Drawn line (may be shifted sideways to keep the rotate handle free). */
  a: Vec2;
  b: Vec2;
  /** Label anchor point and alignment. */
  label: Vec2;
  anchor: 'middle' | 'start';
  /** True when the line is too short for the label: the label sits next to the line, not on it. */
  beside: boolean;
  shifted: boolean;
}

/**
 * Where to draw a clearance (#125). `px` = metres per screen pixel. Short lines get
 * their label beside the line (above a horizontal line, right of a vertical one), so the
 * line stays visible. A line that would cross `avoid` (the rotate handle of the selected
 * item) is shifted parallel, so the handle stays free to grab.
 */
export function layoutClearance(c: Pick<Clearance, 'from' | 'to' | 'distance'>, px: number, avoid?: Vec2 | null): ClearanceLayout {
  let a = c.from;
  let b = c.to;
  const d = normalize(sub(b, a));
  const n = perp(d);
  let shifted = false;
  if (avoid && closestPointOnSegment(avoid, a, b).distance < HANDLE_CLEAR_PX * px) {
    a = add(a, scale(n, HANDLE_SHIFT_PX * px));
    b = add(b, scale(n, HANDLE_SHIFT_PX * px));
    shifted = true;
  }
  const mid = scale(add(a, b), 0.5);
  const beside = dist(a, b) / px < labelWidthPx(clearanceLabel(c.distance)) + 10;
  if (!beside) return { a, b, label: mid, anchor: 'middle', beside, shifted };
  const horizontal = Math.abs(d.x) >= Math.abs(d.y);
  const label = horizontal ? { x: mid.x, y: mid.y - 10 * px } : { x: mid.x + 7 * px, y: mid.y };
  return { a, b, label, anchor: horizontal ? 'middle' : 'start', beside, shifted };
}

/** Rotate handle of a selected item in plan coordinates (drawn 22 px behind its back edge, see PlanDrawing). */
export function rotateHandlePoint(f: Pick<Furniture, 'x' | 'y' | 'depth' | 'rotation'>, px: number): Vec2 {
  return add({ x: f.x, y: f.y }, rotate({ x: 0, y: -f.depth / 2 - 22 * px }, f.rotation));
}
