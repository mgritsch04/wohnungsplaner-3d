/**
 * Narrow passages (#68)
 * ---------------------
 * Finds places where a person would have to squeeze through: gaps between two
 * pieces of furniture, between furniture and a wall face of the same room, and
 * doors/passages whose clear width is below `settings.minPassageWidth`.
 *
 * Heuristics (a guideline, not a building code):
 * - Obstacles are the furniture footprints (rotated bounding boxes). Rugs, curtains
 *   and other textiles are ignored, and so is anything mounted higher than
 *   HANGING_ELEVATION (wall cabinets, shelves, pendants) – you walk underneath.
 * - Furniture ↔ furniture: only gaps wider than ASSEMBLED_GAP count. Items that touch
 *   or nearly touch were put together on purpose (sofa + side table). Pairs that
 *   may overlap by design (chair under table, kitchen inserts) are skipped too, and so
 *   is seating ↔ low table (sofa + coffee table: the gap is legroom, not a path).
 * - Small free-standing items (footprint ≤ SMALL_ITEM, e.g. floor lamp, plant) do not
 *   form passages – you walk around them. They still block a gap they stand in.
 * - Furniture ↔ wall: a gap below WALL_NO_PATH (25 cm) is "standing at the wall" –
 *   nobody walks behind a sideboard 10 cm from the wall, so that is not a passage.
 *   A real passage needs at least shoulder width; 25 cm is well below every
 *   sensible passage but above usual wall distances of furniture (0–15 cm).
 * - A gap counts only if no third obstacle lies across it (otherwise the gaps to
 *   that third item are the relevant ones).
 * - Doors and doorless passages: the opening width is taken as the clear width.
 * Widths are compared in whole millimetres, so 60 cm with a 60 cm minimum is fine.
 */
import type { DerivedPlan } from './derived';
import { pairRule, isTextile } from './placementRules';
import type { Furniture, Project } from './schema';
import { add, closestPointOnSegment, dist, dot, pointInPolygon, rotate, scale, sub, type Vec2 } from './vec';

export const ASSEMBLED_GAP = 0.05;
export const WALL_NO_PATH = 0.25;
export const HANGING_ELEVATION = 1.2;
export const SMALL_ITEM = 0.5;

const isLowTable = (f: Furniture) => (f.category === 'table' || f.category === 'desk') && f.height < 0.55;
/** Pairs placed close on purpose, whose gap is not meant as a path. */
function intendedPair(a: Furniture, b: Furniture): boolean {
  if (pairRule(a, b).allowed) return true;
  return (a.category === 'sofa' && isLowTable(b)) || (b.category === 'sofa' && isLowTable(a));
}
const isSmall = (f: Furniture) => Math.max(f.width, f.depth) <= SMALL_ITEM;

export type PassageRef = { type: 'furniture' | 'wall' | 'opening' | 'room'; id: string };

export interface NarrowPassage {
  /** The two points of the narrowest spot (plan metres). */
  a: Vec2;
  b: Vec2;
  /** Clear width in metres. */
  width: number;
  kind: 'furniture' | 'wall' | 'opening';
  /** What forms the passage: two furniture items, furniture + wall, or the door/passage. */
  refs: PassageRef[];
  roomId?: string;
}

/** Rotated bounding box of a furniture item. */
export function furnitureFootprint(f: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Vec2[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => add({ x: f.x, y: f.y }, rotate({ x: (sx * f.width) / 2, y: (sy * f.depth) / 2 }, f.rotation)));
}

export function isPassageObstacle(f: Furniture): boolean {
  return !isTextile(f) && f.height >= 0.05 && f.elevation < HANGING_ELEVATION;
}

interface Gap {
  a: Vec2;
  b: Vec2;
  d: number;
  /** measured between parallel edges (mid of the overlap) – preferred over corners at equal distance */
  parallel?: boolean;
}

const better = (g: Gap, best: Gap) => g.d < best.d - 1e-9 || (g.parallel && !best.parallel && g.d < best.d + 1e-9);

function segSegClosest(p0: Vec2, p1: Vec2, q0: Vec2, q1: Vec2): Gap {
  const u = sub(p1, p0);
  const L = Math.hypot(u.x, u.y);
  const v = sub(q1, q0);
  if (L > 1e-9 && Math.abs(u.x * v.y - u.y * v.x) < 1e-9 * L * Math.hypot(v.x, v.y)) {
    // parallel edges facing each other: measure in the middle of their overlap,
    // so the marker sits where one would walk through (not at a corner)
    const dir = scale(u, 1 / L);
    const t0 = dot(sub(q0, p0), dir);
    const t1 = dot(sub(q1, p0), dir);
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(L, Math.max(t0, t1));
    if (hi - lo > 1e-6) {
      const a = add(p0, scale(dir, (lo + hi) / 2));
      const c = closestPointOnSegment(a, q0, q1);
      return { a, b: c.point, d: c.distance, parallel: true };
    }
  }
  // non-intersecting segments: the minimum is at one of the four endpoints
  let best: Gap = { a: p0, b: q0, d: Infinity };
  for (const [p, a, b, flip] of [
    [p0, q0, q1, false],
    [p1, q0, q1, false],
    [q0, p0, p1, true],
    [q1, p0, p1, true],
  ] as const) {
    const c = closestPointOnSegment(p, a, b);
    if (c.distance < best.d) best = flip ? { a: c.point, b: p, d: c.distance } : { a: p, b: c.point, d: c.distance };
  }
  return best;
}

function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  return a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a));
}

function segmentsCross(p0: Vec2, p1: Vec2, q0: Vec2, q1: Vec2): boolean {
  const o = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(q0, q1, p0);
  const d2 = o(q0, q1, p1);
  const d3 = o(p0, p1, q0);
  const d4 = o(p0, p1, q1);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Closest points between two convex polygons (distance 0 when they overlap). */
function polygonGap(a: Vec2[], b: Vec2[]): Gap {
  let best: Gap = { a: a[0], b: b[0], d: Infinity };
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j];
      const b1 = b[(j + 1) % b.length];
      if (segmentsCross(a0, a1, b0, b1)) return { a: a0, b: a0, d: 0 };
      const g = segSegClosest(a0, a1, b0, b1);
      if (better(g, best)) best = g;
    }
  }
  if (polygonsOverlap(a, b)) return { a: best.a, b: best.a, d: 0 };
  return best;
}

/** Closest points between a convex polygon and a segment. */
function polygonSegmentGap(poly: Vec2[], s0: Vec2, s1: Vec2): Gap {
  let best: Gap = { a: poly[0], b: s0, d: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const g = segSegClosest(poly[i], poly[(i + 1) % poly.length], s0, s1);
    if (better(g, best)) best = g;
  }
  return best;
}

/** True when the straight line across the gap passes through another obstacle. */
function blocked(g: Gap, others: Vec2[][]): boolean {
  // shrink a little so touching the gap's own end points does not count
  const t = 0.02;
  const p = add(g.a, scale({ x: g.b.x - g.a.x, y: g.b.y - g.a.y }, t));
  const q = add(g.a, scale({ x: g.b.x - g.a.x, y: g.b.y - g.a.y }, 1 - t));
  const mid = scale(add(p, q), 0.5);
  return others.some((o) => pointInPolygon(mid, o) || o.some((v, i) => segmentsCross(p, q, v, o[(i + 1) % o.length])));
}

const mm = (m: number) => Math.round(m * 1000);
const narrower = (w: number, min: number) => mm(w) < mm(min);

/** Nearest wall (by footprint) to a point, for the reference of a furniture ↔ wall passage. */
function nearestWall(derived: DerivedPlan, p: Vec2): string | null {
  let best: { id: string; d: number } | null = null;
  for (const [id, fp] of derived.footprints) {
    const poly = fp.polygon;
    for (let i = 0; i < poly.length; i++) {
      const d = closestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]).distance;
      if (!best || d < best.d) best = { id, d };
    }
  }
  return best?.id ?? null;
}

export function findNarrowPassages(project: Project, derived: DerivedPlan, minWidth = project.settings.minPassageWidth): NarrowPassage[] {
  const out: NarrowPassage[] = [];

  // doors and doorless passages
  for (const [, res] of derived.openings) {
    for (const r of res) {
      const o = r.opening;
      if (o.kind === 'window') continue;
      const fp = derived.footprints.get(o.wallId);
      if (!fp) continue;
      const width = r.s1 - r.s0;
      if (!narrower(width, minWidth)) continue;
      out.push({ a: add(fp.a, scale(fp.dir, r.s0)), b: add(fp.a, scale(fp.dir, r.s1)), width, kind: 'opening', refs: [{ type: 'opening', id: o.id }] });
    }
  }

  const items = project.furniture.filter(isPassageObstacle).map((f) => ({ f, poly: furnitureFootprint(f) }));
  for (const room of project.rooms) {
    const g = derived.rooms.get(room.id);
    if (!g) continue;
    const inRoom = items.filter((it) => pointInPolygon({ x: it.f.x, y: it.f.y }, g.interior));
    if (inRoom.length === 0) continue;
    const polys = inRoom.map((it) => it.poly);

    // furniture ↔ furniture
    for (let i = 0; i < inRoom.length; i++) {
      for (let j = i + 1; j < inRoom.length; j++) {
        const A = inRoom[i];
        const B = inRoom[j];
        // cheap reject: centres too far apart for any narrow gap
        const reach = (Math.hypot(A.f.width, A.f.depth) + Math.hypot(B.f.width, B.f.depth)) / 2 + minWidth;
        if (dist(A.f, B.f) > reach) continue;
        if (isSmall(A.f) || isSmall(B.f) || intendedPair(A.f, B.f)) continue;
        const gap = polygonGap(A.poly, B.poly);
        if (gap.d <= ASSEMBLED_GAP || !narrower(gap.d, minWidth)) continue;
        if (blocked(gap, polys.filter((_, k) => k !== i && k !== j))) continue;
        out.push({ a: gap.a, b: gap.b, width: gap.d, kind: 'furniture', refs: [{ type: 'furniture', id: A.f.id }, { type: 'furniture', id: B.f.id }], roomId: room.id });
      }
    }

    // furniture ↔ wall faces of the same room (one result per wall edge)
    const edges = g.interior;
    for (let i = 0; i < inRoom.length; i++) {
      const it = inRoom[i];
      if (isSmall(it.f)) continue;
      for (let e = 0; e < edges.length; e++) {
        const s0 = edges[e];
        const s1 = edges[(e + 1) % edges.length];
        const gap = polygonSegmentGap(it.poly, s0, s1);
        if (gap.d < WALL_NO_PATH || !narrower(gap.d, minWidth)) continue;
        if (blocked(gap, polys.filter((_, k) => k !== i))) continue;
        const wallId = nearestWall(derived, gap.b);
        out.push({
          a: gap.a,
          b: gap.b,
          width: gap.d,
          kind: 'wall',
          refs: [{ type: 'furniture', id: it.f.id }, wallId ? { type: 'wall', id: wallId } : { type: 'room', id: room.id }],
          roomId: room.id,
        });
      }
    }
  }
  return out;
}

/** "60 cm" – width label for the plan and the 3D marker. */
export function passageLabel(width: number): string {
  return `${Math.round(width * 100)} cm`;
}
