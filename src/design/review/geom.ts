/**
 * Small geometry helpers of the walk-through (#441): rotated rectangles, convex overlap and
 * distances. Everything in plan coordinates (m).
 */
import { add, dist, scale, sub, type Vec2 } from '../../model/vec';

/** Pose of a piece: centre, rotation and size; the local front is +y (see `frontOf`). */
export interface Pose {
  x: number;
  y: number;
  rotation: number;
  width: number;
  depth: number;
}

export const rightVec = (rotation: number): Vec2 => ({ x: Math.cos(rotation), y: Math.sin(rotation) });
export const frontVec = (rotation: number): Vec2 => ({ x: -Math.sin(rotation), y: Math.cos(rotation) });

/** Point of the local frame (u to the right, v to the front, from the centre) in plan coordinates. */
export function toPlan(p: Pose, u: number, v: number): Vec2 {
  const r = rightVec(p.rotation);
  const f = frontVec(p.rotation);
  return { x: p.x + r.x * u + f.x * v, y: p.y + r.y * u + f.y * v };
}

/** Plan point in the local frame of a piece. */
export function toLocal(p: Pose, pt: Vec2): { u: number; v: number } {
  const r = rightVec(p.rotation);
  const f = frontVec(p.rotation);
  const d = sub(pt, p);
  return { u: d.x * r.x + d.y * r.y, v: d.x * f.x + d.y * f.y };
}

/** Rectangle by local ranges u0..u1 (right) and v0..v1 (front), as a polygon. */
export function localRect(p: Pose, u0: number, u1: number, v0: number, v1: number): Vec2[] {
  return [toPlan(p, u0, v0), toPlan(p, u1, v0), toPlan(p, u1, v1), toPlan(p, u0, v1)];
}

export const footprint = (p: Pose, grow = 0): Vec2[] => localRect(p, -p.width / 2 - grow, p.width / 2 + grow, -p.depth / 2 - grow, p.depth / 2 + grow);

export function axisRect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function bounds(poly: readonly Vec2[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

function axes(poly: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const e = sub(poly[(i + 1) % poly.length], poly[i]);
    const l = Math.hypot(e.x, e.y);
    if (l > 1e-9) out.push({ x: -e.y / l, y: e.x / l });
  }
  return out;
}

function project(poly: readonly Vec2[], ax: Vec2): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const v = p.x * ax.x + p.y * ax.y;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

/** Two convex polygons share area (touching does not count). */
export function overlaps(a: readonly Vec2[], b: readonly Vec2[], eps = 1e-6): boolean {
  for (const ax of [...axes(a), ...axes(b)]) {
    const [a0, a1] = project(a, ax);
    const [b0, b1] = project(b, ax);
    if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
  }
  return true;
}

export function segmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  return dist(p, add(a, scale(ab, t)));
}

function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function segmentSegmentDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(segmentDist(a, c, d), segmentDist(b, c, d), segmentDist(c, a, b), segmentDist(d, a, b));
}

/** Smallest distance between two convex polygons; 0 when they overlap or touch. */
export function polyDist(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (overlaps(a, b, -1e-9)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++)
    for (let k = 0; k < b.length; k++) best = Math.min(best, segmentSegmentDist(a[i], a[(i + 1) % a.length], b[k], b[(k + 1) % b.length]));
  return best;
}

/** A segment passes through the inside of a convex polygon. */
export function segmentHitsConvex(a: Vec2, b: Vec2, poly: readonly Vec2[]): boolean {
  const inside = (p: Vec2) => {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const c = e.x * (p.y - poly[i].y) - e.y * (p.x - poly[i].x);
      if (Math.abs(c) < 1e-9) continue;
      if (sign === 0) sign = Math.sign(c);
      else if (sign !== Math.sign(c)) return false;
    }
    return true;
  };
  if (inside(a) || inside(b)) return true;
  for (let i = 0; i < poly.length; i++) if (segmentsCross(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
  return false;
}

/** Distance from a point to the closed boundary of a polygon. */
export function boundaryDist(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segmentDist(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** Angle between two directions (rad, 0–π). */
export function angleBetween(a: Vec2, b: Vec2): number {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb))));
}

export const cm = (m: number): number => Math.round(m * 100);

/** Distance from a point to a convex polygon; 0 inside. */
export function pointPolyDist(p: Vec2, poly: readonly Vec2[]): number {
  const inside = poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;
  }) || poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 1e-9;
  });
  return inside ? 0 : boundaryDist(p, poly);
}
