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
import { add, dot, normalize, perp, pointInPolygon, polygonArea, polygonCentroid, scale, signedArea, sub, type Vec2 } from './vec';
import { normalizeAngle } from './units';

export interface Obstacle {
  polygon: Vec2[];
  z0: number;
  z1: number;
  kind: 'wall' | 'door-leaf';
  refId: string;
}

/** Thickness of the (open) door leaf used as obstacle. */
const LEAF_T = 0.045;
/** Floor clearance under a door leaf (undercut) – rugs may lie below it. */
const LEAF_UNDERCUT = 0.015;

export function buildPlacementObstacles(d: DerivedPlan): Obstacle[] {
  const out: Obstacle[] = [];
  for (const [wallId, pieces] of d.pieces) for (const pc of pieces) out.push({ polygon: pc.polygon, z0: pc.z0, z1: pc.z1, kind: 'wall', refId: wallId });
  for (const h of d.hubs) out.push({ polygon: h.polygon, z0: 0, z1: h.height, kind: 'wall', refId: h.nodeId });
  for (const [wallId, list] of d.openings) {
    const fp = d.footprints.get(wallId);
    if (!fp) continue;
    for (const r of list) {
      if (r.opening.kind !== 'door') continue;
      // the leaf is shown opened by 90° along the swing side – it is solid
      const ds = doorSymbol(fp, r);
      const along = normalize(sub(ds.openTip, ds.hinge));
      const side = scale(perp(along), LEAF_T / 2);
      const a = ds.hinge;
      const b = ds.openTip;
      out.push({ polygon: [add(a, side), add(b, side), sub(b, side), sub(a, side)], z0: r.bottom + LEAF_UNDERCUT, z1: r.top, kind: 'door-leaf', refId: r.opening.id });
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

export function collidingObstacles(pose: Pose, obstacles: Obstacle[]): Obstacle[] {
  const fc = furnitureCorners(pose);
  return obstacles.filter((o) => heightOverlap(pose, o) && footprintsOverlap(fc, o.polygon, 1e-4));
}

/** Push a pose out of all overlapping obstacles (a few iterations handle corners). */
function resolve(pose: Pose, obstacles: Obstacle[]): Pose {
  let p = { ...pose };
  for (let it = 0; it < 6; it++) {
    let moved = false;
    for (const o of obstacles) {
      if (!heightOverlap(p, o)) continue;
      const m = mtv(furnitureCorners(p), o.polygon);
      if (!m) continue;
      p = { ...p, x: p.x + m.x, y: p.y + m.y };
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
  const relevant = obstacles.filter((o) => heightOverlap(start, o));
  const stuck = new Set(collidingObstacles(current, relevant));
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
    p = { ...p, x: p.x + desired.x - prevDesired.x, y: p.y + desired.y - prevDesired.y };
    if (stuck.size) for (const o of [...stuck]) if (!collidingObstacles(p, [o]).length) stuck.delete(o);
    p = resolve(p, active());
  }
  const blocked = Math.hypot(p.x - target.x, p.y - target.y) > 1e-3;
  return { x: p.x, y: p.y, blocked };
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
export function snapToWalls(pose: Pose, d: DerivedPlan, distance = 0.12, angleTol = (20 * Math.PI) / 180, gap = 0.003): WallSnap {
  let p = { ...pose };
  const wallIds: string[] = [];
  const faces: { wallId: string; point: Vec2; n: Vec2; dir: Vec2; a: Vec2; b: Vec2 }[] = [];
  for (const [wallId, fp] of d.footprints) {
    for (const s of [1, -1] as const) {
      const n = scale(fp.normal, s);
      const off = scale(n, fp.thickness / 2);
      faces.push({ wallId, point: add(fp.a, off), n, dir: fp.dir, a: add(fp.a, off), b: add(fp.b, off) });
    }
  }
  const back = (r: number) => ({ x: Math.sin(r), y: -Math.cos(r) }); // rotate((0,-1), r)
  const candidates = faces
    .map((f) => {
      const c = { x: p.x, y: p.y };
      const side = dot(sub(c, f.point), f.n);
      if (side <= 0) return null; // object is behind this face
      // object's projection along the face must overlap the face extent
      const L = dot(sub(f.b, f.a), f.dir);
      const t = dot(sub(c, f.a), f.dir);
      const half = Math.max(p.width, p.depth) / 2;
      if (t < -half || t > L + half) return null;
      const bdir = back(p.rotation);
      const angle = Math.acos(Math.max(-1, Math.min(1, -dot(bdir, f.n))));
      if (angle > angleTol) return null;
      // distance of the rear side to the face if the item were aligned
      const g = side - p.depth / 2;
      if (g < -p.depth / 2 || g > distance) return null;
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
  kind: 'wall' | 'door-leaf' | 'door-swing' | 'outside' | 'overlap';
  message: string;
  refId?: string;
  /** Where the item intersects the obstacle (footprint ∩ obstacle, common height range). */
  region?: CollisionRegion;
  /** The responsible obstacle area itself (wall piece, door leaf, door swing, other item). */
  culprit?: CollisionRegion;
}

/** Wall/door-leaf intersections are errors; swing/outside are warnings; overlaps are informational. */
export function issueLevel(kind: PlacementIssue['kind']): 'error' | 'warn' | 'info' {
  return kind === 'wall' || kind === 'door-leaf' ? 'error' : kind === 'door-swing' || kind === 'outside' ? 'warn' : 'info';
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

/** Human-readable description of a door: width and the room its leaf opens into. */
function describeDoor(p: Project, d: DerivedPlan, openingId: string): string {
  const o = p.openings.find((x) => x.id === openingId);
  const fp = o ? d.footprints.get(o.wallId) : undefined;
  const r = fp ? d.openings.get(o!.wallId)?.find((x) => x.opening.id === openingId) : undefined;
  if (!o || !fp || !r) return 'Tür';
  const ds = doorSymbol(fp, r);
  const probe = add(ds.hinge, scale(sub(ds.openTip, ds.hinge), 0.5));
  const room = p.rooms.find((rm) => {
    const g = d.rooms.get(rm.id);
    return g && pointInPolygon(probe, g.interior);
  });
  return `Tür ${Math.round(o.width * 100)} cm${room?.name ? ` (${room.name})` : ''}`;
}

/** Quarter-circle door swing approximated by its bounding square on the swing side. */
const swingCache = new WeakMap<DerivedPlan, { polygon: Vec2[]; openingId: string; z1: number }[]>();
function doorSwingAreas(d: DerivedPlan): { polygon: Vec2[]; openingId: string; z1: number }[] {
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
      const r0 = ds.hinge;
      const r1 = ds.closedTip;
      out.push({ polygon: [r0, r1, add(r1, scale(n, ds.radius)), add(r0, scale(n, ds.radius))], openingId: r.opening.id, z1: r.top });
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
        ? { kind: 'wall', message: 'Ragt in eine Wand.', refId: o.refId, region, culprit }
        : { kind: 'door-leaf', message: `Steht im geöffneten Türblatt – ${describeDoor(p, d, o.refId)}.`, refId: o.refId, region, culprit },
    );
  }
  if (item.elevation < 0.05 && item.solid) {
    for (const s of doorSwingAreas(d)) {
      if (footprintsOverlap(fc, s.polygon, 1e-3) && !issues.some((i) => i.refId === s.openingId)) {
        const culprit = { polygon: s.polygon, z0: 0, z1: s.z1 };
        issues.push({
          kind: 'door-swing',
          message: `Blockiert den Türaufschlag – ${describeDoor(p, d, s.openingId)} lässt sich nicht ganz öffnen.`,
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
    if (!inAny && !issues.some((i) => i.kind === 'wall')) issues.push({ kind: 'outside', message: centerIn ? 'Ragt aus dem Raum hinaus.' : 'Steht außerhalb der Räume.' });
  }
  for (const o of p.furniture) {
    if (o.id === item.id || o.category === 'textile' || item.category === 'textile') continue;
    if (Math.min(o.elevation + o.height, item.elevation + item.height) - Math.max(o.elevation, item.elevation) <= 0.005) continue;
    const oc = furnitureCorners(o);
    if (footprintsOverlap(fc, oc, 0.003)) {
      const culprit = { polygon: oc, z0: o.elevation, z1: o.elevation + o.height };
      issues.push({ kind: 'overlap', message: `Überschneidet sich mit „${o.name}“.`, refId: o.id, region: intersection(item, fc, culprit), culprit });
    }
  }
  return issues;
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
    const s = snapToWalls({ ...f, x: goal.x, y: goal.y }, derived);
    if (s.wallIds.length) {
      goal = { x: s.x, y: s.y };
      rotation = s.rotation;
      snapped = s.wallIds;
    }
  }
  if (opts.collide && !free) {
    const r = constrainMove({ ...f, rotation }, goal, obstacles, undefined, f);
    goal = { x: r.x, y: r.y };
  }
  f.x = Math.round(goal.x * 1000) / 1000;
  f.y = Math.round(goal.y * 1000) / 1000;
  f.rotation = rotation;
  return snapped;
}
