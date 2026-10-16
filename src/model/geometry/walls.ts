import type { Opening, Wall } from '../schema';
import type { PlanIndex } from '../graph';
import { add, dot, lineIntersection, normalize, perp, scale, signedArea, sub, type Vec2, dist } from '../vec';

/**
 * Wall footprint computation with proper joins.
 *
 * At every node, the walls meeting there are sorted by angle. Each wall side is
 * mitered against the angular neighbour on that side, which yields clean
 * L-corners, flush T-junctions and X-crossings from one rule. Very sharp angles
 * (miter longer than MITER_LIMIT × thickness) fall back to square ends.
 */
const MITER_LIMIT = 4;

export interface WallFootprint {
  wallId: string;
  /** Centerline start/end. */
  a: Vec2;
  b: Vec2;
  /** Unit direction a→b and its left normal (+perp). */
  dir: Vec2;
  normal: Vec2;
  length: number;
  thickness: number;
  /** Quad: [leftA, leftB, rightB, rightA]. "left" is the +normal side. */
  polygon: Vec2[];
}

interface EndCorners {
  left: Vec2;
  right: Vec2;
}

function endCorners(wall: Wall, atNodeId: string, index: PlanIndex): EndCorners | null {
  const node = index.nodes.get(atNodeId);
  const otherId = wall.a === atNodeId ? wall.b : wall.a;
  const other = index.nodes.get(otherId);
  if (!node || !other) return null;
  const d = normalize(sub(other, node));
  const n = perp(d);
  const h = wall.thickness / 2;
  const squareLeft = add(node, scale(n, h));
  const squareRight = sub(node, scale(n, h));

  const neighbours = (index.wallsAtNode.get(atNodeId) ?? []).filter((w) => w.id !== wall.id);
  if (neighbours.length === 0) return { left: squareLeft, right: squareRight };

  const angleOf = (w: Wall) => {
    const oid = w.a === atNodeId ? w.b : w.a;
    const o = index.nodes.get(oid);
    if (!o) return 0;
    return Math.atan2(o.y - node.y, o.x - node.x);
  };
  const base = Math.atan2(d.y, d.x);
  const rel = (w: Wall) => {
    let r = angleOf(w) - base;
    while (r <= 1e-9) r += 2 * Math.PI;
    while (r > 2 * Math.PI + 1e-9) r -= 2 * Math.PI;
    return r;
  };
  const sorted = neighbours.map((w) => ({ w, r: rel(w) })).sort((p, q) => p.r - q.r);
  const next = sorted[0].w; // smallest positive angle → on the +normal (left) side
  const prev = sorted[sorted.length - 1].w; // largest angle → on the right side

  const sideLine = (w: Wall, sign: 1 | -1) => {
    const oid = w.a === atNodeId ? w.b : w.a;
    const o = index.nodes.get(oid)!;
    const dd = normalize(sub(o, node));
    const nn = perp(dd);
    return { p: add(node, scale(nn, (sign * w.thickness) / 2)), d: dd, t: w.thickness };
  };

  const limit = MITER_LIMIT * Math.max(wall.thickness, 0.01);
  const miter = (own: Vec2, nb: { p: Vec2; d: Vec2; t: number }, fallback: Vec2): Vec2 => {
    const x = lineIntersection(own, d, nb.p, nb.d);
    if (!x) return fallback;
    if (dist(x, node) > Math.max(limit, MITER_LIMIT * nb.t)) return fallback;
    return x;
  };

  const left = miter(squareLeft, sideLine(next, -1), squareLeft);
  const right = miter(squareRight, sideLine(prev, 1), squareRight);
  return { left, right };
}

export function computeWallFootprint(wall: Wall, index: PlanIndex): WallFootprint | null {
  const a = index.nodes.get(wall.a);
  const b = index.nodes.get(wall.b);
  if (!a || !b) return null;
  const length = dist(a, b);
  if (length < 1e-6) return null;
  const dir = normalize(sub(b, a));
  const normal = perp(dir);
  const ea = endCorners(wall, wall.a, index);
  const eb = endCorners(wall, wall.b, index);
  if (!ea || !eb) return null;
  // At end b the local direction is reversed, so its "left" is the wall's right side.
  const polygon = [ea.left, eb.right, eb.left, ea.right];
  return { wallId: wall.id, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, dir, normal, length, thickness: wall.thickness, polygon };
}

export function computeAllFootprints(index: PlanIndex): Map<string, WallFootprint> {
  const out = new Map<string, WallFootprint>();
  for (const w of index.walls.values()) {
    const f = computeWallFootprint(w, index);
    if (f) out.set(w.id, f);
  }
  return out;
}

/** Clip a convex polygon to the half-plane dot(p - origin, axis) >= value (or <= when keepBelow). */
function clipHalfPlane(poly: Vec2[], origin: Vec2, axis: Vec2, value: number, keepBelow: boolean): Vec2[] {
  const f = (p: Vec2) => {
    const s = dot(sub(p, origin), axis) - value;
    return keepBelow ? -s : s;
  };
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

/** The part of the footprint between centerline stations s0..s1 (meters from node a). */
export function clipFootprint(fp: WallFootprint, s0: number, s1: number): Vec2[] {
  let poly = fp.polygon;
  if (Number.isFinite(s0)) poly = clipHalfPlane(poly, fp.a, fp.dir, s0, false);
  if (Number.isFinite(s1)) poly = clipHalfPlane(poly, fp.a, fp.dir, s1, true);
  return poly;
}

export interface WallPiece {
  /** Footprint polygon (convex) of this prism. */
  polygon: Vec2[];
  /** Vertical extent in meters. */
  z0: number;
  z1: number;
}

export interface ResolvedOpening {
  opening: Opening;
  /** Start/end station along the centerline, clamped into the wall. */
  s0: number;
  s1: number;
  bottom: number;
  top: number;
  /** True when the stored values had to be clamped to fit the wall. */
  clamped: boolean;
}

/** Clamp openings into the wall and drop those that do not fit at all. */
export function resolveOpenings(wall: Wall, fp: WallFootprint, openings: Opening[]): ResolvedOpening[] {
  const res: ResolvedOpening[] = [];
  for (const o of openings) {
    const width = Math.min(o.width, fp.length);
    let center = o.offset;
    const half = width / 2;
    center = Math.max(half, Math.min(fp.length - half, center));
    const bottom = Math.max(0, Math.min(o.sillHeight, wall.height - 0.05));
    const top = Math.min(wall.height, bottom + o.height);
    if (top - bottom < 0.05 || width < 0.05) continue;
    const clamped = Math.abs(center - o.offset) > 1e-6 || width !== o.width || top !== o.sillHeight + o.height || bottom !== o.sillHeight;
    res.push({ opening: o, s0: center - half, s1: center + half, bottom, top, clamped });
  }
  return res.sort((p, q) => p.s0 - q.s0);
}

/**
 * Split a wall into solid prisms around its openings:
 * full-height segments between openings, plus sill (below) and lintel (above) pieces.
 * Overlapping openings are merged conservatively.
 */
export function buildWallPieces(wall: Wall, fp: WallFootprint, openings: ResolvedOpening[]): WallPiece[] {
  const pieces: WallPiece[] = [];
  let cursor = -Infinity;
  for (const o of openings) {
    const s0 = Math.max(o.s0, Number.isFinite(cursor) ? cursor : o.s0);
    if (o.s1 <= s0) continue;
    const solid = clipFootprint(fp, cursor, s0);
    if (solid.length >= 3) pieces.push({ polygon: solid, z0: 0, z1: wall.height });
    const gap = clipFootprint(fp, s0, o.s1);
    if (gap.length >= 3) {
      if (o.bottom > 1e-4) pieces.push({ polygon: gap, z0: 0, z1: o.bottom });
      if (o.top < wall.height - 1e-4) pieces.push({ polygon: gap, z0: o.top, z1: wall.height });
    }
    cursor = o.s1;
  }
  const rest = clipFootprint(fp, cursor, Infinity);
  if (rest.length >= 3) pieces.push({ polygon: rest, z0: 0, z1: wall.height });
  return pieces;
}

/** Ensure counter-clockwise (positive signed area) ordering. */
export function ensurePositiveArea(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

export interface JunctionHub {
  nodeId: string;
  /** Convex polygon filling the gap where 3+ walls meet. */
  polygon: Vec2[];
  height: number;
}

function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Fill polygons for nodes where three or more walls meet (T- and X-junctions). */
export function computeJunctionHubs(index: PlanIndex, footprints: Map<string, WallFootprint>): JunctionHub[] {
  const hubs: JunctionHub[] = [];
  for (const [nodeId, walls] of index.wallsAtNode) {
    if (walls.length < 3) continue;
    const node = index.nodes.get(nodeId);
    if (!node) continue;
    const pts: Vec2[] = [{ x: node.x, y: node.y }];
    let height = 0;
    for (const w of walls) {
      const fp = footprints.get(w.id);
      if (!fp) continue;
      height = Math.max(height, w.height);
      if (w.a === nodeId) pts.push(fp.polygon[0], fp.polygon[3]);
      else pts.push(fp.polygon[1], fp.polygon[2]);
    }
    const hull = convexHull(pts);
    if (hull.length >= 3 && Math.abs(signedArea(hull)) > 1e-8) hubs.push({ nodeId, polygon: ensurePositiveArea(hull), height });
  }
  return hubs;
}
