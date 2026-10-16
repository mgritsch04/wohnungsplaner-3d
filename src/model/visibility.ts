/**
 * Sight lines (#89): what can be seen from a viewpoint?
 * ------------------------------------------------------
 * Classic visibility polygon by angular ray casting: rays from the viewpoint to every
 * end point of every occluding segment (and slightly to both sides of it); each ray
 * stops at the nearest segment. Sorting the hits by angle gives the visible region.
 *
 * Occluders are the wall faces. Doorless passages and OPEN doors are gaps in the wall,
 * closed doors and windows count as wall (looking outside does not count, the plan
 * only shows the flat). Furniture is not an occluder in this first version.
 * Only the area inside the rooms is evaluated (see visibleShare()).
 */
import type { DerivedPlan } from './derived';
import { clipFootprint } from './geometry/walls';
import type { Project } from './schema';
import { add, boundsOf, pointInPolygon, polygonArea, scale, type Vec2 } from './vec';

export interface Segment {
  a: Vec2;
  b: Vec2;
}

const seeThrough = (o: { kind: string; open: boolean }) => o.kind === 'passage' || (o.kind === 'door' && o.open);

/** Occluding edges: outlines of the wall pieces between see-through openings, plus junction hubs. */
export function sightOccluders(project: Project, derived: DerivedPlan): Segment[] {
  const polys: Vec2[][] = [];
  for (const w of project.walls) {
    const fp = derived.footprints.get(w.id);
    if (!fp) continue;
    let cursor = -Infinity;
    for (const r of derived.openings.get(w.id) ?? []) {
      if (!seeThrough(r.opening)) continue;
      polys.push(clipFootprint(fp, cursor, r.s0));
      cursor = r.s1;
    }
    polys.push(clipFootprint(fp, cursor, Infinity));
  }
  for (const h of derived.hubs) polys.push(h.polygon);
  const segs: Segment[] = [];
  for (const p of polys) {
    if (p.length < 3) continue;
    for (let i = 0; i < p.length; i++) segs.push({ a: p[i], b: p[(i + 1) % p.length] });
  }
  return segs;
}

/** Distance along the ray (origin o, direction d) to segment s, or Infinity. */
function rayHit(o: Vec2, d: Vec2, s: Segment): number {
  const ex = s.b.x - s.a.x;
  const ey = s.b.y - s.a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const ax = s.a.x - o.x;
  const ay = s.a.y - o.y;
  const t = (ax * ey - ay * ex) / den;
  const u = (ax * d.y - ay * d.x) / den;
  return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

/**
 * Visibility polygon around `p` (plan metres). `range` closes the polygon where no wall
 * stops a ray (e.g. looking out of an open front door).
 */
export function visibilityPolygon(p: Vec2, segments: Segment[], range: number): Vec2[] {
  const angles: number[] = [];
  const EPS = 1e-4;
  for (const s of segments)
    for (const q of [s.a, s.b]) {
      const a = Math.atan2(q.y - p.y, q.x - p.x);
      angles.push(a - EPS, a, a + EPS);
    }
  // a coarse fan as well, so open sides are closed by the range circle
  for (let i = 0; i < 64; i++) angles.push(-Math.PI + (i * 2 * Math.PI) / 64);
  angles.sort((x, y) => x - y);
  const out: Vec2[] = [];
  for (const a of angles) {
    const d = { x: Math.cos(a), y: Math.sin(a) };
    let t = range;
    for (const s of segments) t = Math.min(t, rayHit(p, d, s));
    const q = add(p, scale(d, t));
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - q.x) > 1e-7 || Math.abs(last.y - q.y) > 1e-7) out.push(q);
  }
  return out;
}

export interface SightResult {
  polygon: Vec2[];
  /** Share of the room floor area that is visible (0…1), sampled on a grid. */
  share: number;
}

/** Visible region and its share of the rooms' floor area (grid of `cell` metres). */
export function sightFrom(project: Project, derived: DerivedPlan, p: Vec2, cell = 0.1): SightResult {
  const rooms = [...derived.rooms.values()].map((g) => g.interior).filter((r) => r.length >= 3);
  const b = boundsOf(rooms.flat());
  const range = b ? Math.hypot(b.maxX - b.minX, b.maxY - b.minY) + 1 : 50;
  const polygon = visibilityPolygon(p, sightOccluders(project, derived), range);
  let total = 0;
  let seen = 0;
  if (b && rooms.length) {
    for (let y = b.minY + cell / 2; y < b.maxY; y += cell)
      for (let x = b.minX + cell / 2; x < b.maxX; x += cell) {
        const q = { x, y };
        if (!rooms.some((r) => pointInPolygon(q, r))) continue;
        total++;
        if (pointInPolygon(q, polygon)) seen++;
      }
  }
  return { polygon, share: total ? seen / total : 0 };
}

/**
 * Default viewpoint: the entrance. The model has no explicit entrance flag, so it is the
 * first door with a room on one side only (an outer door), 30 cm inside that room;
 * otherwise the first door, otherwise the centre of the first room.
 */
export function defaultViewpoint(project: Project, derived: DerivedPlan): Vec2 | null {
  const rooms = [...derived.rooms.values()].map((g) => g.interior);
  let fallback: Vec2 | null = null;
  for (const o of project.openings) {
    if (o.kind !== 'door') continue;
    const fp = derived.footprints.get(o.wallId);
    const r = derived.openings.get(o.wallId)?.find((x) => x.opening.id === o.id);
    if (!fp || !r) continue;
    const mid = add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
    const inside = (s: 1 | -1) => add(mid, scale(fp.normal, s * (fp.thickness / 2 + 0.3)));
    const inL = rooms.some((poly) => pointInPolygon(inside(1), poly));
    const inR = rooms.some((poly) => pointInPolygon(inside(-1), poly));
    if (inL !== inR) return inside(inL ? 1 : -1);
    fallback ??= inL ? inside(1) : mid;
  }
  if (fallback) return fallback;
  const first = [...derived.rooms.values()][0];
  return first ? first.centroid : null;
}

/** Area of the visibility polygon (for tests and diagnostics). */
export const sightArea = (r: SightResult) => polygonArea(r.polygon);
