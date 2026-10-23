/**
 * Plane geometry of the solver: oriented boxes (a piece's footprint), convex polygons (door
 * swings, movement areas) and the room outline. Plan coordinates in metres; a box's local
 * front is +y like `Furniture.rotation` (see `rotationFacing`).
 */
import { pointInPolygon, type Vec2 } from '../../model/vec';

export interface Box {
  x: number;
  y: number;
  /** Half width (local x) and half depth (local y, towards the front). */
  hw: number;
  hd: number;
  rotation: number;
}

/** Local right (+x) and front (+y) of a rotation. */
export const axisX = (rot: number): Vec2 => ({ x: Math.cos(rot), y: Math.sin(rot) });
export const axisY = (rot: number): Vec2 => ({ x: -Math.sin(rot), y: Math.cos(rot) });

export function boxCorners(b: Box): Vec2[] {
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  const rx = c * b.hw;
  const ry = s * b.hw;
  const fx = -s * b.hd;
  const fy = c * b.hd;
  return [
    { x: b.x - rx - fx, y: b.y - ry - fy },
    { x: b.x + rx - fx, y: b.y + ry - fy },
    { x: b.x + rx + fx, y: b.y + ry + fy },
    { x: b.x - rx + fx, y: b.y - ry + fy },
  ];
}

/** Box from a centre on the back edge: `back` + `fwd` × depth/2. */
export function boxFromBack(back: Vec2, rotation: number, width: number, depth: number): Box {
  const f = axisY(rotation);
  return { x: back.x + (f.x * depth) / 2, y: back.y + (f.y * depth) / 2, hw: width / 2, hd: depth / 2, rotation };
}

/** Distance from a point to a box (0 inside). */
export function distToBox(px: number, py: number, b: Box): number {
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  const dx = px - b.x;
  const dy = py - b.y;
  const u = Math.abs(dx * c + dy * s) - b.hw;
  const v = Math.abs(-dx * s + dy * c) - b.hd;
  if (u <= 0 && v <= 0) return 0;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}

export interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function aabbOf(pts: readonly Vec2[]): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function project(poly: readonly Vec2[], ax: number, ay: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const d = p.x * ax + p.y * ay;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/**
 * Penetration depth of two convex polygons (separating axis test): the smallest push that
 * separates them, 0 when they do not overlap.
 */
export function overlapDepth(a: readonly Vec2[], b: readonly Vec2[]): number {
  // quick reject on the bounding boxes
  let aMinX = Infinity;
  let aMaxX = -Infinity;
  let aMinY = Infinity;
  let aMaxY = -Infinity;
  for (const p of a) {
    if (p.x < aMinX) aMinX = p.x;
    if (p.x > aMaxX) aMaxX = p.x;
    if (p.y < aMinY) aMinY = p.y;
    if (p.y > aMaxY) aMaxY = p.y;
  }
  let bMinX = Infinity;
  let bMaxX = -Infinity;
  let bMinY = Infinity;
  let bMaxY = -Infinity;
  for (const p of b) {
    if (p.x < bMinX) bMinX = p.x;
    if (p.x > bMaxX) bMaxX = p.x;
    if (p.y < bMinY) bMinY = p.y;
    if (p.y > bMaxY) bMaxY = p.y;
  }
  const sepX = bMinX >= aMaxX || bMaxX <= aMinX;
  const sepY = bMinY >= aMaxY || bMaxY <= aMinY;
  if (sepX || sepY) return 0;
  let best = Infinity;
  for (const poly of [a, b]) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      let ax = q.y - p.y;
      let ay = p.x - q.x;
      const len = Math.hypot(ax, ay);
      if (len < 1e-9) continue;
      ax /= len;
      ay /= len;
      const [a0, a1] = project(a, ax, ay);
      const [b0, b1] = project(b, ax, ay);
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return 0;
      if (o < best) best = o;
    }
  }
  return best === Infinity ? 0 : best;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 < 1e-12 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t);
}

/** Clear distance between two convex polygons (0 when they touch or overlap). */
export function gapBetween(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (overlapDepth(a, b) > 0) return 0;
  let best = Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const v of p) {
      for (let i = 0; i < q.length; i++) {
        const d = segDist(v, q[i], q[(i + 1) % q.length]);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/** Distance from a point to a segment. */
export const distToSegment = segDist;

/**
 * How far a convex shape sticks out of the room outline (m, summed over its corners), plus a
 * penalty for room corners poking into it (the inner corner of an L-shaped room). 0 = inside.
 */
const convexCache = new WeakMap<readonly Vec2[], boolean>();

/** Polygon without reflex corners (either winding). */
export function isConvex(poly: readonly Vec2[]): boolean {
  let c = convexCache.get(poly);
  if (c !== undefined) return c;
  let sign = 0;
  c = true;
  for (let i = 0; i < poly.length && c; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d = poly[(i + 2) % poly.length];
    const z = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (Math.abs(z) < 1e-9) continue;
    if (sign === 0) sign = z > 0 ? 1 : -1;
    else if (sign * z < 0) c = false;
  }
  convexCache.set(poly, c);
  return c;
}

export function outsideAmount(shape: readonly Vec2[], room: readonly Vec2[], tol = 0.005): number {
  let amount = 0;
  for (const p of shape) {
    if (pointInPolygon(p, room as Vec2[])) continue;
    let d = Infinity;
    for (let i = 0; i < room.length; i++) d = Math.min(d, segDist(p, room[i], room[(i + 1) % room.length]));
    if (d > tol) amount += d;
  }
  // a convex room cannot poke into a shape whose corners are all inside
  if (isConvex(room)) return amount;
  for (const v of room) if (pointInConvex(v, shape, tol)) amount += 0.05 + depthInConvex(v, shape);
  return amount;
}

/** Point strictly inside a convex polygon (by more than `tol`), either winding. */
export function pointInConvex(p: Vec2, poly: readonly Vec2[], tol = 0): boolean {
  return depthInConvex(p, poly) > tol;
}

/** Distance of a point inside a convex polygon to its boundary; ≤ 0 outside. */
export function depthInConvex(p: Vec2, poly: readonly Vec2[]): number {
  let sign = 0;
  let depth = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const c = (ex * (p.y - a.y) - ey * (p.x - a.x)) / len;
    if (sign === 0) sign = c >= 0 ? 1 : -1;
    const d = c * sign;
    if (d < depth) depth = d;
  }
  return depth === Infinity ? 0 : depth;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Angle wrapped to (−π, π]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}
