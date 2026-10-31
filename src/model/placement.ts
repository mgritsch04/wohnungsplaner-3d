/**
 * Furniture placement rules: collision with walls/door leaves, wall snapping
 * and placement warnings. Pure functions on plan coordinates (meters).
 *
 * Obstacles are convex polygons with a vertical extent; a furniture item only
 * collides with obstacles that overlap its own height range, so a low sideboard
 * may stand under a window (above the sill it is free), while a wardrobe may not.
 */
import { doorSymbol } from '../editor2d/openingSymbols';
import { furnitureCorners, footprintsOverlap } from '../editor2d/furnitureGeometry';
import type { DerivedPlan } from './derived';
import type { Furniture, Project } from './schema';
import { add, dot, normalize, perp, pointInPolygon, polygonArea, polygonCentroid, rotate, scale, signedArea, sub, type Vec2 } from './vec';
import { normalizeAngle } from './units';
import { frontClearance, isRug, isStackable, isSurface, pairRule, seatAndTable, seatBackDepth } from './placementRules';
import { LEAF_OPEN_ANGLE, leafPolygon } from './geometry/leaves';
import { clipFootprint } from './geometry/walls';
import { snapToFurniture, type SnapGuide } from './furnitureSnap';
import { coveredConnections, fixtureCenterZ, fixtureCorners, FIXTURE_LABEL } from './fixtures';

export interface Obstacle {
  polygon: Vec2[];
  z0: number;
  z1: number;
  /** 'door-leaf' = an opened door leaf or window sash (#21). */
  kind: 'wall' | 'door-leaf' | 'furniture';
  refId: string;
  /**
   * Chair under a table (#16): only the rear `seatBack` metres of the moving item's footprint
   * (its backrest) count against this obstacle – the seat may go under the table top.
   */
  seatBack?: number;
}

/** Rear strip of depth `back` of an item's footprint (local −y side, the backrest of a chair). */
export function backStripCorners(f: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>, back: number): Vec2[] {
  const b = Math.min(back, f.depth);
  const c = add({ x: f.x, y: f.y }, rotate({ x: 0, y: -f.depth / 2 + b / 2 }, f.rotation));
  return furnitureCorners({ x: c.x, y: c.y, width: f.width, depth: b, rotation: f.rotation });
}

/** The part of the moving item's footprint `fc` that is tested against obstacle `o`. */
export function probeCorners(pose: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>, o: Obstacle, fc: Vec2[]): Vec2[] {
  return o.seatBack ? backStripCorners(pose, o.seatBack) : fc;
}

/**
 * `closedOpenings`: closed doors and windows block as well, within the height of their leaves
 * (#39) – used while carrying an item in the walkthrough, where the walker is stopped by them
 * too. Plan editing leaves them open, so furniture can be moved through any doorway.
 */
export function buildPlacementObstacles(d: DerivedPlan, opts: { closedOpenings?: boolean } = {}): Obstacle[] {
  const out: Obstacle[] = [];
  for (const [wallId, pieces] of d.pieces) for (const pc of pieces) out.push({ polygon: pc.polygon, z0: pc.z0, z1: pc.z1, kind: 'wall', refId: wallId });
  for (const h of d.hubs) out.push({ polygon: h.polygon, z0: 0, z1: h.height, kind: 'wall', refId: h.nodeId });
  for (const [wallId, list] of d.openings) {
    for (const r of list) {
      // an opened leaf (door: 90° along the swing side, as in the plan; window sash: into the
      // room) is solid within its height; a closed one lies in the wall opening and blocks nothing
      for (const l of d.leaves.get(r.opening.id) ?? []) {
        if (l.open) out.push({ polygon: leafPolygon(l, LEAF_OPEN_ANGLE), z0: l.z0, z1: l.z1, kind: 'door-leaf', refId: r.opening.id });
      }
      const closed = (d.leaves.get(r.opening.id) ?? []).filter((l) => !l.open);
      const fp = d.footprints.get(wallId);
      if (opts.closedOpenings && closed.length && fp) {
        const polygon = clipFootprint(fp, r.s0, r.s1);
        const z0 = Math.min(...closed.map((l) => l.z0));
        const z1 = Math.max(...closed.map((l) => l.z1));
        if (polygon.length >= 3) out.push({ polygon, z0, z1, kind: 'wall', refId: r.opening.id });
      }
    }
  }
  return out;
}

const heightOverlap = (f: Pick<Furniture, 'elevation' | 'height'>, o: Obstacle) => Math.min(f.elevation + f.height, o.z1) - Math.max(f.elevation, o.z0) > 0.005;

/** Minimum translation vector pushing convex polygon A out of convex polygon B (null if separated). */
export function mtv(a: Vec2[], b: Vec2[], eps = 1e-6): Vec2 | null {
  let best: { axis: Vec2; depth: number } | null = null;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const axis = normalize(perp(sub(q, p)));
      if (axis.x === 0 && axis.y === 0) continue;
      const pa = a.map((v) => dot(v, axis));
      const pb = b.map((v) => dot(v, axis));
      const minA = Math.min(...pa);
      const maxA = Math.max(...pa);
      const minB = Math.min(...pb);
      const maxB = Math.max(...pb);
      if (Math.min(maxA, maxB) - Math.max(minA, minB) <= eps) return null;
      // distance A has to travel along ±axis to be clear of B (also correct if one
      // interval contains the other – a plain overlap length would be too short then)
      const pos = maxB - minA;
      const neg = maxA - minB;
      const depth = Math.min(pos, neg);
      if (!best || depth < best.depth) best = { axis: pos <= neg ? axis : scale(axis, -1), depth };
    }
  }
  return best ? scale(best.axis, best.depth + eps) : null;
}

export type Pose = Pick<Furniture, 'x' | 'y' | 'rotation' | 'width' | 'depth' | 'elevation' | 'height'>;

/** Cheap pre-test: do the bounding boxes of the footprint and the obstacle overlap? */
function boxesOverlap(fc: Vec2[], o: Obstacle): boolean {
  const b = obstacleInfo(o);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of fc) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return maxX >= b.minX && minX <= b.maxX && maxY >= b.minY && minY <= b.maxY;
}

export function collidingObstacles(pose: Pose, obstacles: Obstacle[]): Obstacle[] {
  const fc = furnitureCorners(pose);
  return obstacles.filter((o) => {
    if (!heightOverlap(pose, o)) return false;
    const pc = probeCorners(pose, o, fc);
    return boxesOverlap(pc, o) && footprintsOverlap(pc, o.polygon, 1e-4);
  });
}

const boundsCache = new WeakMap<Obstacle, { minX: number; maxX: number; minY: number; maxY: number; thickness: number }>();
function obstacleInfo(o: Obstacle) {
  let b = boundsCache.get(o);
  if (!b) {
    const xs = o.polygon.map((q) => q.x);
    const ys = o.polygon.map((q) => q.y);
    // minimum width of the convex polygon: smallest extent perpendicular to one of its edges
    let thickness = Infinity;
    for (let i = 0; i < o.polygon.length; i++) {
      const a = o.polygon[i];
      const n = normalize(perp(sub(o.polygon[(i + 1) % o.polygon.length], a)));
      if (n.x === 0 && n.y === 0) continue;
      const proj = o.polygon.map((q) => dot(sub(q, a), n));
      thickness = Math.min(thickness, Math.max(...proj) - Math.min(...proj));
    }
    b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), thickness };
    boundsCache.set(o, b);
  }
  return b;
}
const obstacleBounds = obstacleInfo;
const obstacleThickness = (o: Obstacle) => obstacleInfo(o).thickness;

/** Overlaps up to this depth (m) are contact, not "already inside" (see `constrainMove`). */
const STUCK_DEPTH = 0.002;

/** How far (m) `pose` reaches into obstacle `o` (0 if separated). */
function penetration(pose: Pose, o: Obstacle): number {
  const m = mtv(probeCorners(pose, o, furnitureCorners(pose)), o.polygon);
  return m ? Math.hypot(m.x, m.y) : 0;
}

/** Push a pose out of all overlapping obstacles (a few iterations handle corners). */
function resolve(pose: Pose, obstacles: Obstacle[]): Pose {
  let p = { ...pose };
  for (let it = 0; it < 6; it++) {
    let moved = false;
    let fc = furnitureCorners(p);
    for (const o of obstacles) {
      const pc = probeCorners(p, o, fc);
      if (!heightOverlap(p, o) || !boxesOverlap(pc, o)) continue;
      const m = mtv(pc, o.polygon);
      if (!m) continue;
      p = { ...p, x: p.x + m.x, y: p.y + m.y };
      fc = furnitureCorners(p);
      moved = true;
    }
    if (!moved) break;
  }
  return p;
}

/**
 * Move a furniture item from its current pose towards a target, step by step,
 * so it can never tunnel through a wall; blocked movement slides along walls.
 * Returns the reachable position.
 *
 * `current` is the pose before this move (default: `start`). Obstacles it already
 * intersects (an item placed into a door leaf earlier, or with Alt) are not used
 * to push it around – that would make it jump – so it can be dragged out freely;
 * they count again as soon as the item is clear of them.
 */
export function constrainMove(
  start: Pose,
  target: { x: number; y: number },
  obstacles: Obstacle[],
  maxStep = 0.02,
  current: Pose = start,
): { x: number; y: number; blocked: boolean } {
  // only obstacles near the swept area matter (cheap bounding-box test)
  const reach = Math.hypot(start.width, start.depth) / 2 + 0.05;
  const sweep = {
    minX: Math.min(start.x, target.x, current.x) - reach,
    maxX: Math.max(start.x, target.x, current.x) + reach,
    minY: Math.min(start.y, target.y, current.y) - reach,
    maxY: Math.max(start.y, target.y, current.y) + reach,
  };
  const relevant = obstacles.filter((o) => {
    if (!heightOverlap(start, o)) return false;
    const b = obstacleBounds(o);
    return b.maxX >= sweep.minX && b.minX <= sweep.maxX && b.maxY >= sweep.minY && b.minY <= sweep.maxY;
  });
  // a step must stay well below the thinnest obstacle, otherwise the push-out could
  // resolve to the far side of a thin partition (tunnelling)
  const thinnest = relevant.reduce((m, o) => Math.min(m, obstacleThickness(o)), Infinity);
  maxStep = Math.max(0.004, Math.min(maxStep, thinnest / 3));
  // only a real overlap counts as "already inside": an item resting flush against a wall
  // (millimetre rounding can leave it a fraction of a millimetre in it) must keep being
  // blocked by that wall, otherwise it glides straight through it (#39)
  const stuck = new Set(collidingObstacles(current, relevant).filter((o) => penetration(current, o) > STUCK_DEPTH));
  const active = () => relevant.filter((o) => !stuck.has(o));
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / maxStep));
  let p: Pose = { ...start };
  // e.g. after snapping rotated the item: push it out of obstacles it newly touches
  p = resolve(p, active());
  for (let i = 1; i <= steps; i++) {
    const desired = { x: start.x + (dx * i) / steps, y: start.y + (dy * i) / steps };
    // keep accumulated sliding offsets: move by the step delta from the current pose
    const prevDesired = { x: start.x + (dx * (i - 1)) / steps, y: start.y + (dy * (i - 1)) / steps };
    const before = p;
    p = { ...p, x: p.x + desired.x - prevDesired.x, y: p.y + desired.y - prevDesired.y };
    const freed = stuck.size > 0 && [...stuck].some((o) => !collidingObstacles(p, [o]).length && stuck.delete(o));
    p = resolve(p, active());
    // completely blocked: every further step would end in the same place
    if (!freed && Math.abs(p.x - before.x) < 1e-9 && Math.abs(p.y - before.y) < 1e-9) break;
  }
  const blocked = Math.hypot(p.x - target.x, p.y - target.y) > 1e-3;
  return { x: p.x, y: p.y, blocked };
}

/** Length of [t0, t1] ∩ [0, L] that is not inside one of the open ranges. */
function solidLength(t0: number, t1: number, L: number, open: [number, number][]): number {
  const a = Math.max(0, t0);
  const b = Math.min(L, t1);
  if (b <= a) return 0;
  let len = b - a;
  for (const [o0, o1] of open) len -= Math.max(0, Math.min(b, o1) - Math.max(a, o0));
  return len;
}

export interface WallSnap {
  x: number;
  y: number;
  rotation: number;
  wallIds: string[];
}

/**
 * Snap an item against nearby wall faces: if its rear side (local −y) is within
 * `distance` of a wall face it faces (±`angleTol`), rotate it parallel and move it flush.
 * Applied to the raw drag target each time, so it is deterministic (no jitter build-up).
 */
export function snapToWalls(
  pose: Pose,
  d: DerivedPlan,
  distance = 0.12,
  angleTol = (20 * Math.PI) / 180,
  gap = 0.003,
  /** Walls the item is attached to right now: they hold it up to `releaseDistance` (hysteresis). */
  attachedTo: readonly string[] = [],
  releaseDistance = 0.2,
): WallSnap {
  let p = { ...pose };
  const wallIds: string[] = [];
  const faces: { wallId: string; point: Vec2; n: Vec2; dir: Vec2; a: Vec2; b: Vec2; open: [number, number][] }[] = [];
  for (const [wallId, fp] of d.footprints) {
    // door openings and passages are no wall to stand against
    const open = (d.openings.get(wallId) ?? []).filter((r) => r.opening.kind !== 'window').map((r) => [r.s0, r.s1] as [number, number]);
    for (const s of [1, -1] as const) {
      const n = scale(fp.normal, s);
      const off = scale(n, fp.thickness / 2);
      faces.push({ wallId, point: add(fp.a, off), n, dir: fp.dir, a: add(fp.a, off), b: add(fp.b, off), open });
    }
  }
  const back = (r: number) => ({ x: Math.sin(r), y: -Math.cos(r) }); // rotate((0,-1), r)
  const candidates = faces
    .map((f) => {
      const c = { x: p.x, y: p.y };
      const side = dot(sub(c, f.point), f.n);
      if (side <= 0) return null; // object is behind this face
      // the item (once aligned, its width runs along the face) must have solid wall behind it
      const L = dot(sub(f.b, f.a), f.dir);
      const t = dot(sub(c, f.a), f.dir);
      const solid = solidLength(t - p.width / 2, t + p.width / 2, L, f.open);
      if (solid < Math.min(0.2, 0.3 * p.width)) return null;
      const bdir = back(p.rotation);
      const angle = Math.acos(Math.max(-1, Math.min(1, -dot(bdir, f.n))));
      if (angle > angleTol) return null;
      // distance of the rear side to the face if the item were aligned
      const g = side - p.depth / 2;
      if (g < -p.depth / 2 || g > (attachedTo.includes(f.wallId) ? releaseDistance : distance)) return null;
      return { f, g };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((x, y) => x.g - y.g);
  const best = candidates[0];
  if (!best) return { x: p.x, y: p.y, rotation: p.rotation, wallIds };
  const f = best.f;
  const rotation = normalizeAngle(Math.atan2(-f.n.x, f.n.y));
  p = { ...p, rotation };
  const side = dot(sub({ x: p.x, y: p.y }, f.point), f.n);
  const shift = p.depth / 2 + gap - side;
  p = { ...p, x: p.x + f.n.x * shift, y: p.y + f.n.y * shift };
  wallIds.push(f.wallId);
  // corner: also snap a side against a perpendicular face close by
  for (const g of faces) {
    if (g.wallId === f.wallId || Math.abs(dot(g.n, f.n)) > 0.05) continue;
    const c = { x: p.x, y: p.y };
    const side2 = dot(sub(c, g.point), g.n);
    const halfExtent = Math.abs(dot(scale(f.dir, p.width / 2), g.n)) + Math.abs(dot(scale(f.n, p.depth / 2), g.n));
    const gap2 = side2 - halfExtent;
    const t = dot(sub(c, g.a), g.dir);
    const L = dot(sub(g.b, g.a), g.dir);
    if (side2 > 0 && gap2 >= -0.01 && gap2 <= distance && t > -p.depth && t < L + p.depth) {
      p = { ...p, x: p.x - g.n.x * (gap2 - gap), y: p.y - g.n.y * (gap2 - gap) };
      wallIds.push(g.wallId);
      break;
    }
  }
  return { x: p.x, y: p.y, rotation: p.rotation, wallIds };
}

/** A vertical prism in plan coordinates (used for collision feedback). */
export interface CollisionRegion {
  polygon: Vec2[];
  z0: number;
  z1: number;
}

export interface PlacementIssue {
  kind: 'wall' | 'door-leaf' | 'door-swing' | 'outside' | 'overlap' | 'clearance' | 'connection';
  message: string;
  /** Short reason why the item is marked, e.g. „ragt in die Wand“, „überlappt mit „Sofa““ (#16). */
  short: string;
  refId?: string;
  /** Where the item intersects the obstacle (footprint ∩ obstacle, common height range). */
  region?: CollisionRegion;
  /** The responsible obstacle area itself (wall piece, door leaf, door swing, other item). */
  culprit?: CollisionRegion;
}

/**
 * Real intersections (wall, door leaf, other furniture) are errors; door swing,
 * outside the room and missing space in front of doors/drawers are warnings.
 * Intended combinations (rug, chair under table, kitchen inserts) are no issue at all – for a
 * chair under a table only as long as its backrest stays out of the table (#16).
 */
export function issueLevel(kind: PlacementIssue['kind']): 'error' | 'warn' | 'info' {
  return kind === 'wall' || kind === 'door-leaf' || kind === 'overlap' ? 'error' : 'warn';
}

/**
 * Intersection of two convex polygons (Sutherland–Hodgman). Works for either
 * winding; returns [] if they do not overlap (or only touch).
 */
export function clipConvex(subject: Vec2[], clip: Vec2[]): Vec2[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const orient = Math.sign(signedArea(clip)) || 1;
  // inside = on the inner side of edge a→b
  const inside = (p: Vec2, a: Vec2, b: Vec2) => orient * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= -1e-12;
  const cut = (p: Vec2, q: Vec2, a: Vec2, b: Vec2): Vec2 => {
    const r = sub(q, p);
    const e = sub(b, a);
    const den = r.x * e.y - r.y * e.x;
    if (Math.abs(den) < 1e-15) return p;
    const t = ((a.x - p.x) * e.y - (a.y - p.y) * e.x) / den;
    return { x: p.x + r.x * t, y: p.y + r.y * t };
  };
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pin = inside(p, a, b);
      const qin = inside(q, a, b);
      if (pin) out.push(p);
      if (pin !== qin) out.push(cut(p, q, a, b));
    }
  }
  return out.length >= 3 && polygonArea(out) > 1e-8 ? out : [];
}

/** Intersection region of an item with an obstacle prism (null if only touching). */
function intersection(item: Pick<Furniture, 'elevation' | 'height'>, fc: Vec2[], other: CollisionRegion): CollisionRegion | undefined {
  const polygon = clipConvex(fc, other.polygon);
  const z0 = Math.max(item.elevation, other.z0);
  const z1 = Math.min(item.elevation + item.height, other.z1);
  if (!polygon.length || z1 <= z0) return undefined;
  return { polygon, z0, z1 };
}

/** Human-readable description of a door/window: width and the room its leaf opens into. */
function describeOpening(p: Project, d: DerivedPlan, openingId: string): string {
  const o = p.openings.find((x) => x.id === openingId);
  const label = o?.kind === 'window' ? 'Fenster' : 'Tür';
  const leaf = d.leaves.get(openingId)?.[0];
  if (!o || !leaf) return label;
  const probe = add(leaf.hinge, scale(leaf.swingDir, leaf.width / 2));
  const room = p.rooms.find((rm) => {
    const g = d.rooms.get(rm.id);
    return g && pointInPolygon(probe, g.interior);
  });
  return `${label} ${Math.round(o.width * 100)} cm${room?.name ? ` (${room.name})` : ''}`;
}

/** Quarter-circle door swing as a polygon (hinge plus arc points) on the swing side (#267). */
const SWING_STEPS = 8;
const swingCache = new WeakMap<DerivedPlan, { polygon: Vec2[]; openingId: string; z1: number }[]>();
export function doorSwingAreas(d: DerivedPlan): { polygon: Vec2[]; openingId: string; z1: number }[] {
  const cached = swingCache.get(d);
  if (cached) return cached;
  const out: { polygon: Vec2[]; openingId: string; z1: number }[] = [];
  for (const [wallId, list] of d.openings) {
    const fp = d.footprints.get(wallId);
    if (!fp) continue;
    for (const r of list) {
      if (r.opening.kind !== 'door') continue;
      const ds = doorSymbol(fp, r);
      const n = normalize(sub(ds.openTip, ds.hinge));
      const u = normalize(sub(ds.closedTip, ds.hinge));
      const arc = Array.from({ length: SWING_STEPS + 1 }, (_, k) => {
        const a = (k / SWING_STEPS) * (Math.PI / 2);
        return add(ds.hinge, add(scale(u, ds.radius * Math.cos(a)), scale(n, ds.radius * Math.sin(a))));
      });
      out.push({ polygon: [ds.hinge, ...arc], openingId: r.opening.id, z1: r.top });
    }
  }
  swingCache.set(d, out);
  return out;
}

export function placementIssues(p: Project, d: DerivedPlan, item: Furniture, obstacles = buildPlacementObstacles(d)): PlacementIssue[] {
  const issues: PlacementIssue[] = [];
  const fc = furnitureCorners(item);
  for (const o of collidingObstacles(item, obstacles)) {
    const culprit = { polygon: o.polygon, z0: o.z0, z1: o.z1 };
    const region = intersection(item, fc, culprit);
    issues.push(
      o.kind === 'wall'
        ? { kind: 'wall', message: 'Ragt in eine Wand.', short: 'ragt in die Wand', refId: o.refId, region, culprit }
        : {
            kind: 'door-leaf',
            message: `Steht im geöffneten ${p.openings.find((x) => x.id === o.refId)?.kind === 'window' ? 'Fensterflügel' : 'Türblatt'} – ${describeOpening(p, d, o.refId)}.`,
            short: `steht im geöffneten ${p.openings.find((x) => x.id === o.refId)?.kind === 'window' ? 'Fensterflügel' : 'Türblatt'}`,
            refId: o.refId,
            region,
            culprit,
          },
    );
  }
  if (item.elevation < 0.05 && item.solid) {
    for (const s of doorSwingAreas(d)) {
      if (footprintsOverlap(fc, s.polygon, 1e-3) && !issues.some((i) => i.refId === s.openingId)) {
        const culprit = { polygon: s.polygon, z0: 0, z1: s.z1 };
        issues.push({
          kind: 'door-swing',
          message: `Blockiert den Türaufschlag – ${describeOpening(p, d, s.openingId)} lässt sich nicht ganz öffnen.`,
          short: 'blockiert den Türaufschlag',
          refId: s.openingId,
          region: intersection(item, fc, culprit),
          culprit,
        });
      }
    }
  }
  const rooms = [...d.rooms.values()];
  if (rooms.length && item.category !== 'textile') {
    // corners pulled in by 3 mm: an item standing flush against a wall is inside
    const inset = fc.map((c) => add(c, scale(normalize(sub({ x: item.x, y: item.y }, c)), 0.003)));
    const inAny = rooms.some((g) => inset.every((c) => pointInPolygon(c, g.interior)) || polygonArea(g.interior) < 0.01);
    const center = { x: item.x, y: item.y };
    const centerIn = rooms.some((g) => pointInPolygon(center, g.interior));
    if (!inAny && !issues.some((i) => i.kind === 'wall'))
      issues.push(centerIn ? { kind: 'outside', message: 'Ragt aus dem Raum hinaus.', short: 'ragt aus dem Raum' } : { kind: 'outside', message: 'Steht außerhalb der Räume.', short: 'steht außerhalb der Räume' });
  }
  for (const o of p.furniture) {
    if (o.id === item.id) continue;
    if (Math.min(o.elevation + o.height, item.elevation + item.height) - Math.max(o.elevation, item.elevation) <= 0.005) continue;
    const st = seatAndTable(item, o);
    if (st) {
      // chair under table (#16): the seat may go under the table top, the backrest may not
      const back = seatBackDepth(st.seat);
      if (back <= 0) continue;
      const strip = backStripCorners(st.seat, back);
      const tc = furnitureCorners(st.table);
      if (!footprintsOverlap(strip, tc, 0.003)) continue;
      const culprit = st.seat === item ? { polygon: tc, z0: o.elevation, z1: o.elevation + o.height } : { polygon: strip, z0: o.elevation, z1: o.elevation + o.height };
      issues.push({
        kind: 'overlap',
        message:
          st.seat === item
            ? `Die Lehne steht in „${o.name}“ – nur die Sitzfläche passt unter die Tischplatte.`
            : `„${o.name}“ steht mit der Lehne im Tisch – nur die Sitzfläche passt unter die Tischplatte.`,
        short: st.seat === item ? `Lehne steht in „${o.name}“` : `Lehne von „${o.name}“ steht im Tisch`,
        refId: o.id,
        region: intersection(item, st.seat === item ? strip : fc, culprit),
        culprit,
      });
      continue;
    }
    if (pairRule(item, o).allowed) continue;
    const oc = furnitureCorners(o);
    if (footprintsOverlap(fc, oc, 0.003)) {
      const culprit = { polygon: oc, z0: o.elevation, z1: o.elevation + o.height };
      issues.push({ kind: 'overlap', message: `Überschneidet sich mit „${o.name}“.`, short: `überlappt mit „${o.name}“`, refId: o.id, region: intersection(item, fc, culprit), culprit });
    }
  }
  // water / waste-water connections must stay reachable (#81)
  for (const f of coveredConnections(p, item)) {
    const culprit = { polygon: fixtureCorners(f), z0: 0, z1: fixtureCenterZ(f) + 0.05 };
    issues.push({
      kind: 'connection',
      message: `Steht vor einem ${FIXTURE_LABEL[f.kind]} – der Anschluss bleibt so nicht erreichbar.`,
      short: `steht vor einem ${FIXTURE_LABEL[f.kind]}`,
      refId: f.id,
      region: culprit,
      culprit,
    });
  }
  // doors/drawers need free space in front of the item
  const need = frontClearance(item);
  if (need > 0) {
    const zone = frontZone(item, need);
    for (const o of p.furniture) {
      if (o.id === item.id || isRug(o) || pairRule(item, o).allowed || issues.some((i) => i.refId === o.id)) continue;
      // what stands on top (a lamp on the shoe cabinet) does not keep the doors from opening
      if (o.elevation >= item.elevation + item.height - 0.005 || o.elevation + o.height < item.elevation + 0.05) continue;
      // the two runs of an L-shaped kitchen: the module in the corner is the blind corner cabinet
      if (item.kitchen && o.kitchen && Math.abs(Math.cos(item.rotation - o.rotation)) < 0.1) continue;
      const oc = furnitureCorners(o);
      if (!footprintsOverlap(zone, oc, 0.003)) continue;
      const free = frontGap(item, oc);
      const culprit = { polygon: zone, z0: item.elevation, z1: item.elevation + item.height };
      issues.push({
        kind: 'clearance',
        message: `Vor „${item.name}“ sind nur ${Math.max(0, Math.round(free * 100))} cm frei – Türen/Schubladen brauchen etwa ${Math.round(need * 100)} cm („${o.name}“ steht im Weg).`,
        short: `zu wenig Platz vor den Türen („${o.name}“ im Weg)`,
        refId: o.id,
        region: intersection(item, oc, culprit),
        culprit,
      });
    }
  }
  return issues;
}

/** Rectangle of depth `d` directly in front of the item (local +y side). */
function frontZone(f: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>, d: number): Vec2[] {
  const fwd = { x: -Math.sin(f.rotation), y: Math.cos(f.rotation) }; // rotate((0,1), r)
  const c = add({ x: f.x, y: f.y }, scale(fwd, f.depth / 2 + d / 2));
  return furnitureCorners({ x: c.x, y: c.y, width: f.width - 0.02, depth: d, rotation: f.rotation });
}

/** Free distance between the item's front and the nearest corner of polygon `oc`. */
function frontGap(f: Pick<Furniture, 'x' | 'y' | 'depth' | 'rotation'>, oc: Vec2[]): number {
  const fwd = { x: -Math.sin(f.rotation), y: Math.cos(f.rotation) };
  const front = dot({ x: f.x, y: f.y }, fwd) + f.depth / 2;
  return Math.min(...oc.map((q) => dot(q, fwd) - front));
}

export interface FurnitureConflict {
  level: 'error' | 'warn';
  issues: PlacementIssue[];
}

/**
 * Placement conflicts of all furniture (errors: wall/door leaf; warnings: door
 * swing/outside). Shared by the 2D plan and the 3D collision markers.
 */
export function furnitureConflicts(p: Project, d: DerivedPlan, obstacles: Obstacle[]): Map<string, FurnitureConflict> {
  const m = new Map<string, FurnitureConflict>();
  for (const f of p.furniture) {
    const issues = placementIssues(p, d, f, obstacles).filter((i) => issueLevel(i.kind) !== 'info');
    if (!issues.length) continue;
    m.set(f.id, { level: issues.some((i) => issueLevel(i.kind) === 'error') ? 'error' : 'warn', issues });
  }
  return m;
}

/**
 * Why an item is marked (#16): „Rot markiert: ragt in die Wand · überlappt mit „Sofa““ – one
 * line for the properties panel and the hover card. Null when nothing is marked.
 */
export function conflictSummary(issues: PlacementIssue[]): { level: 'error' | 'warn'; label: string; reasons: string[] } | null {
  const marked = issues.filter((i) => issueLevel(i.kind) !== 'info');
  if (!marked.length) return null;
  const level = marked.some((i) => issueLevel(i.kind) === 'error') ? 'error' : 'warn';
  const reasons = [...new Set(marked.map((i) => i.short))];
  return { level, label: level === 'error' ? 'Rot markiert' : 'Orange markiert', reasons };
}

/** Centre of a region (for labels/markers). */
export function regionCenter(r: CollisionRegion): { x: number; y: number; z: number } {
  const c = polygonCentroid(r.polygon);
  return { x: c.x, y: c.y, z: (r.z0 + r.z1) / 2 };
}

export interface MoveOptions {
  /** Snap the rear side to nearby walls. */
  snap: boolean;
  /** Block movement through walls and door leaves. */
  collide: boolean;
  /**
   * Small items stand on the table/cabinet below them (#219). Default: as `snap`; the plan and
   * 3D dragging pass it separately, so it also works with „Möbel einrasten: aus“ (only Alt is free).
   */
  stack?: boolean;
  /** Filled with the alignment guide lines when the item snapped to other furniture. */
  guides?: SnapGuide[];
}

/**
 * Move furniture `id` in the project draft towards `target` (plan meters),
 * applying wall snapping and collision. Shared by 2D drag, 3D drag and nudging.
 * Returns the wall ids the item snapped to (for visual feedback).
 */
export function moveFurnitureTo(d: Project, derived: DerivedPlan, obstacles: Obstacle[], id: string, target: { x: number; y: number }, opts: MoveOptions): string[] {
  const f = d.furniture.find((x) => x.id === id);
  if (!f || f.locked) return [];
  let goal = { x: target.x, y: target.y };
  let rotation = f.rotation;
  let snapped: string[] = [];
  // rugs and wall-mounted items (curtains, mirrors…) are not snapped/blocked the same way
  const free = f.category === 'textile' && f.height < 0.05;
  if (opts.snap && !free) {
    // walls the item stands flush against now keep holding it a bit longer (no flicker)
    const attached = snapToWalls(f, derived, 0.01).wallIds;
    const s = snapToWalls({ ...f, x: goal.x, y: goal.y }, derived, undefined, undefined, undefined, attached);
    if (s.wallIds.length) {
      goal = { x: s.x, y: s.y };
      rotation = s.rotation;
      snapped = s.wallIds;
    }
    // align edges/centres with other furniture on the axes the wall left free
    if (opts.guides) opts.guides.length = 0;
    if (!isStackable(f)) {
      const fs = snapToFurniture(d, f, goal, { x: Math.abs(goal.x - target.x) < 1e-6, y: Math.abs(goal.y - target.y) < 1e-6 });
      goal = { x: fs.x, y: fs.y };
      if (opts.guides) opts.guides.push(...fs.guides);
    }
  }
  // small items (table lamps, decor) stand on the table/cabinet below them
  let elevation = f.elevation;
  if ((opts.stack ?? opts.snap) && isStackable(f) && f.elevation <= 1.3) elevation = surfaceTopAt(d, f.id, goal);
  let rounded = { x: Math.round(goal.x * 1000) / 1000, y: Math.round(goal.y * 1000) / 1000 };
  if (opts.collide) {
    const m = moveCollision(d, { ...f, rotation, elevation }, obstacles);
    // the item as it is, at its new height: stepping down from a cabinet (or up onto it) must not
    // push it out of that cabinet sideways – possibly through the wall behind it (#39); the
    // surface it stood on counts as "already inside" until the item has left it
    const current = m.free ? { ...f, elevation: 0, height: 1 } : { ...f, elevation };
    const r = constrainMove(m.pose, goal, m.obstacles, undefined, current);
    goal = { x: r.x, y: r.y };
    rounded = { x: Math.round(goal.x * 1000) / 1000, y: Math.round(goal.y * 1000) / 1000 };
    // millimetre rounding must not turn "touching" into a tiny overlap (#39)
    const pose = { ...m.pose, ...goal };
    if (collidingObstacles({ ...pose, ...rounded }, m.obstacles).length > collidingObstacles(pose, m.obstacles).length) rounded = goal;
  }
  f.x = rounded.x;
  f.y = rounded.y;
  f.rotation = rotation;
  f.elevation = Math.round(elevation * 1000) / 1000;
  return snapped;
}

/**
 * What a moving item collides with, as used by dragging: walls, opened door leaves and
 * other furniture (intended combinations excluded). Rugs lie under furniture but stop at
 * walls like everything else (#39); a flat rug would never overlap a wall in height, so
 * it is tested with a 1 m tall pose (`pose`).
 */
export function moveCollision(d: Project, f: Furniture, obstacles: Obstacle[]): { pose: Pose; obstacles: Obstacle[]; free: boolean } {
  const free = f.category === 'textile' && f.height < 0.05;
  if (free) return { pose: { ...f, elevation: 0, height: 1 }, obstacles: obstacles.filter((o) => o.kind === 'wall'), free };
  return { pose: { ...f }, obstacles: [...obstacles, ...furnitureObstacles(d, f)], free };
}

/**
 * Rotate furniture `id` in the project draft to `rotation` (radians), checked with the
 * same rules as dragging: if the rotated footprint now reaches into a wall, door leaf
 * or other furniture, the item is pushed back into free space (e.g. a wardrobe
 * turned at a wall moves away from it). The push never carries it into another room.
 * Returns 'ok', 'moved' (pushed into free space) or 'conflict' (no free spot nearby –
 * rotated anyway, the conflict is marked like any other).
 */
export function rotateFurnitureTo(d: Project, derived: DerivedPlan, obstacles: Obstacle[], id: string, rotation: number): 'ok' | 'moved' | 'conflict' {
  const f = d.furniture.find((x) => x.id === id);
  if (!f || f.locked) return 'ok';
  const before: Pose = { ...f };
  f.rotation = normalizeAngle(rotation);
  if (f.category === 'textile' && f.height < 0.05) return 'ok';
  const all = [...obstacles, ...furnitureObstacles(d, f)];
  // obstacles the item already overlapped before turning (placed with Alt) do not push it
  const already = new Set(collidingObstacles(before, all));
  const relevant = all.filter((o) => !already.has(o));
  const hits = collidingObstacles(f, relevant);
  if (!hits.length) return 'ok';
  const pushed = resolve({ ...f }, relevant);
  const reach = Math.max(f.width, f.depth) / 2 + 0.05;
  const room = [...derived.rooms.values()].find((g) => pointInPolygon(before, g.interior));
  const sameRoom = !room || pointInPolygon(pushed, room.interior);
  if (Math.hypot(pushed.x - f.x, pushed.y - f.y) <= reach && sameRoom && !collidingObstacles(pushed, relevant).length) {
    // millimetre rounding must not turn "touching" into a tiny overlap
    const rounded = { ...pushed, x: Math.round(pushed.x * 1000) / 1000, y: Math.round(pushed.y * 1000) / 1000 };
    const final = collidingObstacles(rounded, relevant).length ? pushed : rounded;
    f.x = final.x;
    f.y = final.y;
    return 'moved';
  }
  return 'conflict';
}

/** Other furniture the item must not move into (intended combinations excluded). */
export function furnitureObstacles(d: Project, item: Furniture): Obstacle[] {
  const out: Obstacle[] = [];
  for (const o of d.furniture) {
    if (o.id === item.id) continue;
    const st = seatAndTable(item, o);
    if (st) {
      // chair under table (#16): only the backrest stops at the table edge
      const back = seatBackDepth(st.seat);
      if (back <= 0) continue;
      if (st.seat === item) out.push({ polygon: furnitureCorners(o), z0: o.elevation, z1: o.elevation + o.height, kind: 'furniture', refId: o.id, seatBack: back });
      else out.push({ polygon: backStripCorners(o, back), z0: o.elevation, z1: o.elevation + o.height, kind: 'furniture', refId: o.id });
      continue;
    }
    if (pairRule(item, o).allowed) continue;
    out.push({ polygon: furnitureCorners(o), z0: o.elevation, z1: o.elevation + o.height, kind: 'furniture', refId: o.id });
  }
  return out;
}

/** Height of the highest surface (table, cabinet …) under point `p`, or 0 (floor). */
export function surfaceTopAt(d: Project, exceptId: string, p: Vec2): number {
  let top = 0;
  for (const o of d.furniture) {
    if (o.id === exceptId || !isSurface(o)) continue;
    if (pointInPolygon(p, furnitureCorners(o))) top = Math.max(top, o.elevation + o.height);
  }
  return top;
}

/** Furniture snapping setting (#52) → grid step in metres (null = no grid) and whether walls attract. */
export function furnitureSnapOptions(mode: 'grid5' | 'grid10' | 'wall' | 'off', altKey = false): { grid: number | null; walls: boolean } {
  if (altKey || mode === 'off') return { grid: null, walls: false };
  if (mode === 'wall') return { grid: null, walls: true };
  return { grid: mode === 'grid10' ? 0.1 : 0.05, walls: true };
}


/** Whether a catalog item may be dropped at a plan point (#131): inside a room, or anywhere while there are no rooms. */
export function canDropAt(derived: DerivedPlan, point: Vec2): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const rooms = [...derived.rooms.values()];
  return !rooms.length || rooms.some((g) => pointInPolygon(point, g.interior));
}

/**
 * Places a newly created item (catalog drag and drop, #131) at a dropped plan point: snapped to
 * the grid and to walls as chosen under „Möbel einrasten“ (#52; Alt = free). Returns false and
 * leaves the project unchanged when the point lies outside every room (if there are rooms).
 */
export function placeDroppedFurniture(d: Project, derived: DerivedPlan, f: Furniture, point: Vec2, altKey = false): boolean {
  if (!canDropAt(derived, point)) return false;
  const fs = furnitureSnapOptions(d.settings.furnitureSnap, altKey);
  let c = point;
  if (fs.grid) c = { x: Math.round(c.x / fs.grid) * fs.grid, y: Math.round(c.y / fs.grid) * fs.grid };
  f.x = Math.round(c.x * 1000) / 1000;
  f.y = Math.round(c.y * 1000) / 1000;
  d.furniture.push(f);
  moveFurnitureTo(d, derived, [], f.id, f, { snap: fs.walls, collide: false });
  return true;
}
