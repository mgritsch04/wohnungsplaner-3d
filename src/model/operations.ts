/**
 * Pure model operations on a mutable project draft.
 *
 * All functions here mutate the given draft in place; callers (the store) wrap
 * them with a structured clone so that history snapshots remain immutable.
 * Keeping topology edits in one place guarantees that walls, nodes, openings
 * and room cycles stay consistent with each other.
 */
import { newId } from './ids';
import { buildIndex, findWallBetween } from './graph';
import { computeRoomGeometry } from './geometry/rooms';
import { defaultLeafOpen, type Furniture, type Opening, type OpeningKind, type PlanNode, type Project, type Provenance, type Room, type Wall } from './schema';
import { closestPointOnSegment, cross, dist, dot, normalize, scale, sub, add, type Vec2 } from './vec';
import { roundMm } from './units';
import { pruneGroups } from './groups';

/** Points closer than this are considered the same node. */
export const NODE_MERGE_TOLERANCE = 0.005;

export interface WallProps {
  thickness: number;
  height: number;
  provenance?: Provenance;
}

function nodeById(d: Project, id: string): PlanNode | undefined {
  return d.nodes.find((n) => n.id === id);
}

export function findNodeNear(d: Project, p: Vec2, tol = NODE_MERGE_TOLERANCE): PlanNode | undefined {
  let best: PlanNode | undefined;
  let bestD = tol;
  for (const n of d.nodes) {
    const dd = dist(n, p);
    if (dd <= bestD) {
      best = n;
      bestD = dd;
    }
  }
  return best;
}

export interface WallHit {
  wall: Wall;
  /** Distance along the centerline from node a. */
  s: number;
  point: Vec2;
  distance: number;
  length: number;
}

/** Closest wall centerline to a point. */
export function closestWall(d: Pick<Project, 'nodes' | 'walls'>, p: Vec2, maxDistance = Infinity): WallHit | null {
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  let best: WallHit | null = null;
  for (const w of d.walls) {
    const a = nodes.get(w.a);
    const b = nodes.get(w.b);
    if (!a || !b) continue;
    const c = closestPointOnSegment(p, a, b);
    const length = dist(a, b);
    if (c.distance <= maxDistance && (!best || c.distance < best.distance)) {
      best = { wall: w, s: c.t * length, point: c.point, distance: c.distance, length };
    }
  }
  return best;
}

export function addNode(d: Project, p: Vec2): string {
  const id = newId('node');
  d.nodes.push({ id, x: roundMm(p.x), y: roundMm(p.y) });
  return id;
}

/**
 * Split a wall at a point (projected onto its centerline). Openings are
 * redistributed to the matching half and room cycles get the new node inserted.
 * Returns the id of the node at the split point (an endpoint if the point is at an end).
 */
export function splitWall(d: Project, wallId: string, p: Vec2, tol = NODE_MERGE_TOLERANCE): string {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w) throw new Error(`Wand ${wallId} nicht gefunden`);
  const a = nodeById(d, w.a)!;
  const b = nodeById(d, w.b)!;
  const L = dist(a, b);
  const c = closestPointOnSegment(p, a, b);
  const s = c.t * L;
  if (s <= tol) return w.a;
  if (s >= L - tol) return w.b;
  const nId = addNode(d, c.point);
  const oldB = w.b;
  const w2: Wall = { ...w, id: newId('wall'), a: nId, b: oldB };
  w.b = nId;
  d.walls.push(w2);
  for (const o of d.openings) {
    if (o.wallId !== w.id) continue;
    if (o.offset > s) {
      o.wallId = w2.id;
      o.offset = roundMm(o.offset - s);
    }
  }
  for (const r of d.rooms) insertNodeIntoCycle(r, w.a, oldB, nId);
  return nId;
}

function insertNodeIntoCycle(r: Room, u: string, v: string, n: string) {
  const ids = r.nodeIds;
  for (let i = 0; i < ids.length; i++) {
    const x = ids[i];
    const y = ids[(i + 1) % ids.length];
    if ((x === u && y === v) || (x === v && y === u)) {
      ids.splice(i + 1, 0, n);
      return;
    }
  }
}

/** Existing node near p, or a new node (splitting a wall if p lies on one). */
export function getOrCreateNode(d: Project, p: Vec2, tol = NODE_MERGE_TOLERANCE): string {
  const near = findNodeNear(d, p, tol);
  if (near) return near.id;
  const hit = closestWall(d, p, tol);
  if (hit) return splitWall(d, hit.wall.id, p, tol);
  return addNode(d, p);
}

function segmentIntersectionParams(p: Vec2, p2: Vec2, q: Vec2, q2: Vec2): { t: number; u: number } | null {
  const r = sub(p2, p);
  const s = sub(q2, q);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(q, p);
  return { t: cross(qp, s) / denom, u: cross(qp, r) / denom };
}

/**
 * Insert a straight wall from p to q. Endpoints merge with nearby nodes,
 * existing walls are split at T-junctions and crossings, and collinear
 * overlaps reuse existing walls. Returns the chain of node ids from p to q.
 */
export function insertWall(d: Project, p: Vec2, q: Vec2, props: WallProps, tol = NODE_MERGE_TOLERANCE): string[] {
  const na = getOrCreateNode(d, p, tol);
  const nb = getOrCreateNode(d, q, tol);
  if (na === nb) return [na];
  const A = nodeById(d, na)!;
  const B = nodeById(d, nb)!;
  const len = dist(A, B);

  // Split crossing walls.
  const crossings: { wallId: string; point: Vec2 }[] = [];
  for (const w of d.walls) {
    if (w.a === na || w.b === na || w.a === nb || w.b === nb) continue;
    const wa = nodeById(d, w.a)!;
    const wb = nodeById(d, w.b)!;
    const ip = segmentIntersectionParams(A, B, wa, wb);
    if (!ip) continue;
    const wl = dist(wa, wb);
    if (ip.t * len > tol && ip.t * len < len - tol && ip.u * wl > -tol && ip.u * wl < wl + tol) {
      crossings.push({ wallId: w.id, point: add(A, scale(sub(B, A), ip.t)) });
    }
  }
  for (const c of crossings) getOrCreateNode(d, c.point, tol);

  // Collect nodes lying on the segment.
  const dir = normalize(sub(B, A));
  const onSeg = d.nodes
    .map((n) => ({ n, c: closestPointOnSegment(n, A, B) }))
    .filter(({ c }) => c.distance <= tol)
    .map(({ n }) => ({ id: n.id, s: dot(sub(n, A), dir) }))
    .filter((x) => x.s >= -tol && x.s <= len + tol)
    .sort((x, y) => x.s - y.s);
  const chain: string[] = [];
  for (const x of onSeg) if (chain[chain.length - 1] !== x.id) chain.push(x.id);
  if (chain[0] !== na) chain.unshift(na);
  if (chain[chain.length - 1] !== nb) chain.push(nb);

  for (let i = 0; i < chain.length - 1; i++) {
    const u = chain[i];
    const v = chain[i + 1];
    if (u === v) continue;
    if (findWallBetween(d.walls, u, v)) continue;
    d.walls.push({ id: newId('wall'), a: u, b: v, thickness: props.thickness, height: props.height, provenance: props.provenance });
  }
  return chain;
}

/** Insert a closed polygon of walls along the given centerline points and create a room for it. */
export function addPolygonRoom(d: Project, centerline: Vec2[], name: string, props: WallProps, extra?: Partial<Room>): string {
  const cycle: string[] = [];
  for (let i = 0; i < centerline.length; i++) {
    const chain = insertWall(d, centerline[i], centerline[(i + 1) % centerline.length], props);
    for (let k = 0; k < chain.length - 1; k++) cycle.push(chain[k]);
  }
  const id = newId('room');
  d.rooms.push({ id, name, nodeIds: dedupeCycle(cycle), ...extra });
  return id;
}

function dedupeCycle(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) if (out[out.length - 1] !== id) out.push(id);
  while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

export interface RectRoomInput {
  /** Top-left corner of the CLEAR interior (wall faces). */
  x: number;
  y: number;
  /** Clear interior width (along x) and depth (along y). */
  width: number;
  depth: number;
  name: string;
  thickness: number;
  height: number;
  floorMaterialId?: string;
}

/** Add a rectangular room given its clear interior dimensions. */
export function addRectRoom(d: Project, r: RectRoomInput): string {
  const h = r.thickness / 2;
  const pts = [
    { x: r.x - h, y: r.y - h },
    { x: r.x + r.width + h, y: r.y - h },
    { x: r.x + r.width + h, y: r.y + r.depth + h },
    { x: r.x - h, y: r.y + r.depth + h },
  ];
  return addPolygonRoom(d, pts, r.name, { thickness: r.thickness, height: r.height }, { floorMaterialId: r.floorMaterialId });
}

export function moveNode(d: Project, nodeId: string, p: Vec2) {
  const n = nodeById(d, nodeId);
  if (!n) return;
  n.x = roundMm(p.x);
  n.y = roundMm(p.y);
}

/**
 * Nodes that lie on the same straight wall line as `wallId`, connected through
 * collinear walls (e.g. one long wall split by T-junctions).
 */
export function collinearChainNodes(d: Project, wallId: string, angleTol = 1e-3): string[] {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w) return [];
  const a = nodeById(d, w.a)!;
  const b = nodeById(d, w.b)!;
  const dir = normalize(sub(b, a));
  const onLine = (n: PlanNode) => Math.abs(cross(dir, sub(n, a))) <= Math.max(NODE_MERGE_TOLERANCE, angleTol * dist(n, a));
  const result = new Set<string>([w.a, w.b]);
  const queue = [w.a, w.b];
  while (queue.length) {
    const id = queue.pop()!;
    for (const x of d.walls) {
      if (x.a !== id && x.b !== id) continue;
      const other = x.a === id ? x.b : x.a;
      if (result.has(other)) continue;
      const on = nodeById(d, other);
      if (on && onLine(on)) {
        result.add(other);
        queue.push(other);
      }
    }
  }
  return [...result];
}

export function translateNodes(d: Project, nodeIds: string[], delta: Vec2) {
  const set = new Set(nodeIds);
  for (const n of d.nodes) {
    if (set.has(n.id)) {
      n.x = roundMm(n.x + delta.x);
      n.y = roundMm(n.y + delta.y);
    }
  }
}

/** Move a wall line (with its collinear continuation) by delta. */
export function moveWallLine(d: Project, wallId: string, delta: Vec2, wholeLine = true) {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w) return;
  translateNodes(d, wholeLine ? collinearChainNodes(d, wallId) : [w.a, w.b], delta);
}

/** Change the wall length by moving its end node b along the wall direction. */
export function setWallLength(d: Project, wallId: string, length: number) {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w || length <= 0.01) return;
  const a = nodeById(d, w.a)!;
  const b = nodeById(d, w.b)!;
  const dir = normalize(sub(b, a));
  moveNode(d, w.b, add(a, scale(dir, length)));
}

/** Set the wall angle (radians, plan convention) around node a, keeping the length. */
export function setWallAngle(d: Project, wallId: string, angle: number) {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w) return;
  const a = nodeById(d, w.a)!;
  const b = nodeById(d, w.b)!;
  const L = dist(a, b);
  moveNode(d, w.b, { x: a.x + Math.cos(angle) * L, y: a.y + Math.sin(angle) * L });
}

function removeOrphanNodes(d: Project) {
  const used = new Set<string>();
  for (const w of d.walls) {
    used.add(w.a);
    used.add(w.b);
  }
  d.nodes = d.nodes.filter((n) => used.has(n.id));
}

/** Remove rooms whose cycle has an edge without a wall or a missing node. */
export function removeBrokenRooms(d: Project) {
  const nodeIds = new Set(d.nodes.map((n) => n.id));
  d.rooms = d.rooms.filter((r) => {
    if (r.nodeIds.length < 3) return false;
    for (let i = 0; i < r.nodeIds.length; i++) {
      const u = r.nodeIds[i];
      const v = r.nodeIds[(i + 1) % r.nodeIds.length];
      if (!nodeIds.has(u) || !findWallBetween(d.walls, u, v)) return false;
    }
    return true;
  });
}

export function deleteWalls(d: Project, wallIds: string[]) {
  const set = new Set(wallIds);
  d.walls = d.walls.filter((w) => !set.has(w.id));
  d.openings = d.openings.filter((o) => !set.has(o.wallId));
  removeBrokenRooms(d);
  removeOrphanNodes(d);
}

export function deleteNode(d: Project, nodeId: string) {
  deleteWalls(
    d,
    d.walls.filter((w) => w.a === nodeId || w.b === nodeId).map((w) => w.id),
  );
  d.nodes = d.nodes.filter((n) => n.id !== nodeId);
}

/** Delete a room record (walls stay). */
export function deleteRoom(d: Project, roomId: string) {
  d.rooms = d.rooms.filter((r) => r.id !== roomId);
  dropPlanningOf(d, 'room', roomId);
}

/** Notes pinned to a removed room/furniture and the room's tasks go with it (#83, #84). */
function dropPlanningOf(d: Project, type: 'room' | 'furniture', id: string) {
  d.notes = d.notes.filter((n) => !(n.target.type === type && n.target.id === id));
  if (type === 'room') d.tasks = d.tasks.filter((t) => t.roomId !== id);
}

/** Delete a room together with walls that are not shared with any other room. */
export function deleteRoomWithWalls(d: Project, roomId: string) {
  const room = d.rooms.find((r) => r.id === roomId);
  if (!room) return;
  const others = d.rooms.filter((r) => r.id !== roomId);
  const usedByOthers = (u: string, v: string) =>
    others.some((r) => r.nodeIds.some((id, i) => {
      const nx = r.nodeIds[(i + 1) % r.nodeIds.length];
      return (id === u && nx === v) || (id === v && nx === u);
    }));
  const toDelete: string[] = [];
  for (let i = 0; i < room.nodeIds.length; i++) {
    const u = room.nodeIds[i];
    const v = room.nodeIds[(i + 1) % room.nodeIds.length];
    const w = findWallBetween(d.walls, u, v);
    if (w && !usedByOthers(u, v)) toDelete.push(w.id);
  }
  deleteRoom(d, roomId);
  deleteWalls(d, toDelete);
}

/** Remove collinear vertices (and their indices) from a polygon. */
export function simplifyPolygonIndices(poly: Vec2[], tol = 1e-4): number[] {
  const keep: number[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[(i - 1 + n) % n];
    const c = poly[i];
    const q = poly[(i + 1) % n];
    const u = normalize(sub(c, p));
    const v = normalize(sub(q, c));
    if (Math.abs(cross(u, v)) > tol || dot(u, v) < 0) keep.push(i);
  }
  return keep;
}

/**
 * Resize a rectangular room to the given CLEAR interior width/depth by moving
 * the wall lines opposite to the first corner. Returns false if the room is not rectangular.
 */
export function setRectRoomSize(d: Project, roomId: string, width: number, depth: number): boolean {
  const room = d.rooms.find((r) => r.id === roomId);
  if (!room) return false;
  const index = buildIndex(d);
  const geo = computeRoomGeometry(room, index);
  if (!geo) return false;
  const corners = simplifyPolygonIndices(geo.interior);
  if (corners.length !== 4) return false;
  const P = corners.map((i) => geo.interior[i]);
  const u = sub(P[1], P[0]);
  const v = sub(P[2], P[1]);
  const ul = Math.hypot(u.x, u.y);
  const vl = Math.hypot(v.x, v.y);
  if (Math.abs(dot(u, v)) > 1e-3 * ul * vl) return false;
  const ud = normalize(u);
  const vd = normalize(v);
  const ids = corners.map((i) => room.nodeIds[i]);
  const wallFrom = (n1: string, n2: string) => {
    // first wall of the cycle edge starting at corner n1 towards n2
    const i = room.nodeIds.indexOf(n1);
    const next = room.nodeIds[(i + 1) % room.nodeIds.length];
    return findWallBetween(d.walls, n1, next) ?? findWallBetween(d.walls, n1, n2);
  };
  const dw = width - ul;
  const dd = depth - vl;
  if (Math.abs(dw) > 1e-6) {
    const w = wallFrom(ids[1], ids[2]);
    if (w) moveWallLine(d, w.id, scale(ud, dw));
  }
  if (Math.abs(dd) > 1e-6) {
    const w = wallFrom(ids[2], ids[3]);
    if (w) moveWallLine(d, w.id, scale(vd, dd));
  }
  return true;
}

export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; height: number; sillHeight: number }> = {
  door: { width: 0.9, height: 2.1, sillHeight: 0 },
  window: { width: 1.2, height: 1.4, sillHeight: 0.9 },
  passage: { width: 1.0, height: 2.1, sillHeight: 0 },
};

/** Add an opening centered at station s of a wall, clamped to fit. Returns the id or null. */
export function addOpening(d: Project, wallId: string, kind: OpeningKind, s: number, overrides: Partial<Opening> = {}): string | null {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w) return null;
  const a = nodeById(d, w.a)!;
  const b = nodeById(d, w.b)!;
  const L = dist(a, b);
  const def = OPENING_DEFAULTS[kind];
  const width = Math.min(overrides.width ?? def.width, Math.max(0.1, L - 0.02));
  if (L < 0.2) return null;
  const offset = Math.max(width / 2, Math.min(L - width / 2, s));
  const id = newId(kind === 'window' ? 'win' : kind === 'door' ? 'door' : 'pass');
  d.openings.push({
    id,
    wallId,
    kind,
    offset: roundMm(offset),
    width,
    height: overrides.height ?? def.height,
    sillHeight: overrides.sillHeight ?? def.sillHeight,
    hinge: overrides.hinge ?? 'start',
    swing: overrides.swing ?? 'left',
    open: overrides.open ?? defaultLeafOpen(kind),
    provenance: overrides.provenance,
  });
  return id;
}

/** Doors and windows have a leaf/sash that can be opened; passages have none. */
export const hasLeaf = (o: Pick<Opening, 'kind'>): boolean => o.kind !== 'passage';

/**
 * Open or close the leaf of door/window `id` (#21); toggles when `open` is omitted.
 * Returns the new state, or null when there is no such opening or it has no leaf.
 */
export function setOpeningOpen(d: Project, id: string, open?: boolean): boolean | null {
  const o = d.openings.find((x) => x.id === id);
  if (!o || !hasLeaf(o)) return null;
  o.open = open ?? !o.open;
  return o.open;
}

export function addFurniture(d: Project, f: Omit<Furniture, 'id'> & { id?: string }): string {
  const id = f.id ?? newId('item');
  d.furniture.push({ ...f, id });
  return id;
}

export function duplicateFurniture(d: Project, id: string, offset: Vec2 = { x: 0.3, y: 0.3 }): string | null {
  const f = d.furniture.find((x) => x.id === id);
  if (!f) return null;
  const nid = newId('item');
  // a copy is not part of the source's group; copying a whole group forms a new one (groups.regroupCopies)
  const { groupId: _group, ...rest } = structuredClone(f);
  void _group;
  d.furniture.push({ ...rest, id: nid, x: roundMm(f.x + offset.x), y: roundMm(f.y + offset.y) });
  return nid;
}

export function deleteFurniture(d: Project, ids: string[]) {
  const set = new Set(ids);
  d.furniture = d.furniture.filter((f) => !set.has(f.id));
  for (const id of set) dropPlanningOf(d, 'furniture', id);
  // a group left with a single item dissolves (#65)
  pruneGroups(d);
}

/** Snap a point to (0°, 45°, 90°, …) directions around an origin. */
export function snapAngle(origin: Vec2, p: Vec2, stepRad = Math.PI / 4): Vec2 {
  const v = sub(p, origin);
  const L = Math.hypot(v.x, v.y);
  if (L < 1e-9) return p;
  const ang = Math.round(Math.atan2(v.y, v.x) / stepRad) * stepRad;
  return { x: origin.x + Math.cos(ang) * L, y: origin.y + Math.sin(ang) * L };
}

export function snapToGrid(p: Vec2, grid: number): Vec2 {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/** Merge node `from` into node `to`: rewires walls and room cycles, removes duplicates. */
export function mergeNodes(d: Project, from: string, to: string) {
  for (const w of d.walls) {
    if (w.a === from) w.a = to;
    if (w.b === from) w.b = to;
  }
  // drop degenerate and duplicate walls
  const seen = new Set<string>();
  const removed = new Set<string>();
  d.walls = d.walls.filter((w) => {
    if (w.a === w.b) {
      removed.add(w.id);
      return false;
    }
    const key = [w.a, w.b].sort().join('|');
    if (seen.has(key)) {
      removed.add(w.id);
      return false;
    }
    seen.add(key);
    return true;
  });
  d.openings = d.openings.filter((o) => !removed.has(o.wallId));
  for (const r of d.rooms) {
    r.nodeIds = r.nodeIds.map((id) => (id === from ? to : id)).filter((id, i, arr) => id !== arr[(i + 1) % arr.length]);
  }
  d.rooms = d.rooms.filter((r) => r.nodeIds.length >= 3);
  d.nodes = d.nodes.filter((n) => n.id !== from);
}
