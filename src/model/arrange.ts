/**
 * Align and distribute several furniture items (#51). Pure functions on a project
 * draft (used inside one `apply`, so one undo step).
 *
 * Measured on the rotated footprints: an item's extent is the axis-aligned bounding
 * box of its rotated corners, not its centre. Plan y grows downwards on screen, so
 * "top" is the smallest y.
 *
 * Every new position goes through the same rules as dragging (`moveFurnitureTo` with
 * collision, no snapping): an item that cannot reach its target because a wall, door
 * leaf or other furniture is in the way stops as close as possible in front of it.
 * Items are moved one after another against the already moved ones, so no new
 * overlaps arise (intended combinations like rugs or a chair under a table stay allowed).
 */
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import type { DerivedPlan } from './derived';
import { buildPlacementObstacles, collidingObstacles, moveCollision, moveFurnitureTo, type Obstacle } from './placement';
import type { Furniture, Project } from './schema';

export type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';
export type DistributeAxis = 'x' | 'y';

export interface ArrangeResult {
  /** Items that changed position. */
  moved: string[];
  /** Items that could not reach their target completely (obstacle in the way). */
  blocked: string[];
  /** Locked items (never moved). */
  locked: string[];
  /** Number of items taken into account. */
  total: number;
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Axis-aligned bounding box of the rotated footprint. */
export function footprintBox(f: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Box {
  const c = furnitureCorners(f);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const TOL = 1e-3;
const mm = (v: number) => Math.round(v * 1000) / 1000;

function pick(d: Project, ids: readonly string[]): Furniture[] {
  const set = new Set(ids);
  return d.furniture.filter((f) => set.has(f.id));
}

/**
 * Align the items at the outermost edge (or the middle) of the selection.
 * left/right/centerX move along x, top/bottom/centerY along y.
 */
export function alignFurniture(d: Project, derived: DerivedPlan, ids: readonly string[], edge: AlignEdge, obstacles = buildPlacementObstacles(derived)): ArrangeResult {
  const items = pick(d, ids);
  const result: ArrangeResult = { moved: [], blocked: [], locked: items.filter((f) => f.locked).map((f) => f.id), total: items.length };
  if (items.length < 2) return result;
  const boxes = new Map(items.map((f) => [f.id, footprintBox(f)]));
  const all = [...boxes.values()];
  const axis: DistributeAxis = edge === 'left' || edge === 'right' || edge === 'centerX' ? 'x' : 'y';
  const lo = Math.min(...all.map((b) => (axis === 'x' ? b.minX : b.minY)));
  const hi = Math.max(...all.map((b) => (axis === 'x' ? b.maxX : b.maxY)));
  const targets = new Map<string, number>();
  for (const f of items) {
    const b = boxes.get(f.id)!;
    const bLo = axis === 'x' ? b.minX : b.minY;
    const bHi = axis === 'x' ? b.maxX : b.maxY;
    let delta: number;
    if (edge === 'left' || edge === 'top') delta = lo - bLo;
    else if (edge === 'right' || edge === 'bottom') delta = hi - bHi;
    else delta = (lo + hi) / 2 - (bLo + bHi) / 2;
    targets.set(f.id, (axis === 'x' ? f.x : f.y) + delta);
  }
  moveAll(d, derived, obstacles, items, axis, targets, result);
  return result;
}

/**
 * Distribute ≥ 3 items along an axis: the two outer ones stay, the others get equal
 * gaps between their edges (bounding boxes, so items of different widths work).
 * Order follows the box centres. With fewer than 3 items nothing changes.
 */
export function distributeFurniture(d: Project, derived: DerivedPlan, ids: readonly string[], axis: DistributeAxis, obstacles = buildPlacementObstacles(derived)): ArrangeResult {
  const items = pick(d, ids);
  const result: ArrangeResult = { moved: [], blocked: [], locked: items.filter((f) => f.locked).map((f) => f.id), total: items.length };
  if (items.length < 3) return result;
  const span = (f: Furniture) => {
    const b = footprintBox(f);
    return axis === 'x' ? { lo: b.minX, hi: b.maxX } : { lo: b.minY, hi: b.maxY };
  };
  const sorted = items
    .map((f) => ({ f, ...span(f) }))
    .sort((a, b) => (a.lo + a.hi) / 2 - (b.lo + b.hi) / 2 || (a.f.id < b.f.id ? -1 : 1));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const sizes = sorted.reduce((s, e) => s + (e.hi - e.lo), 0);
  const gap = (last.hi - first.lo - sizes) / (sorted.length - 1);
  const targets = new Map<string, number>();
  let cursor = first.lo;
  for (const e of sorted) {
    const pos = axis === 'x' ? e.f.x : e.f.y;
    // the outer two stay exactly where they are
    targets.set(e.f.id, e === first || e === last ? pos : pos + (cursor - e.lo));
    cursor += e.hi - e.lo + gap;
  }
  moveAll(d, derived, obstacles, sorted.map((e) => e.f), axis, targets, result);
  return result;
}

/**
 * Move each item along `axis` to its target coordinate (centre), shortest moves first.
 * Items blocked by a neighbour that had not moved yet get a second try.
 */
function moveAll(d: Project, derived: DerivedPlan, obstacles: Obstacle[], items: Furniture[], axis: DistributeAxis, targets: Map<string, number>, result: ArrangeResult) {
  const start = new Map(items.map((f) => [f.id, { x: f.x, y: f.y }]));
  const coord = (f: Furniture) => (axis === 'x' ? f.x : f.y);
  let pending = items
    .filter((f) => !f.locked && Math.abs(targets.get(f.id)! - coord(f)) > TOL / 2)
    .sort((a, b) => Math.abs(targets.get(a.id)! - coord(a)) - Math.abs(targets.get(b.id)! - coord(b)));
  for (let pass = 0; pass < 3 && pending.length; pass++) {
    const was = pending.map(coord);
    const next: Furniture[] = [];
    for (const f of pending) {
      const t = targets.get(f.id)!;
      moveAlong(d, derived, obstacles, f.id, axis, t);
      const g = d.furniture.find((x) => x.id === f.id)!;
      if (Math.abs(coord(g) - t) > TOL) next.push(g);
    }
    // stop when a pass changes nothing more
    const progress = pending.some((f, i) => Math.abs(coord(f) - was[i]) > 1e-9);
    pending = next;
    if (!progress) break;
  }
  result.blocked = pending.map((f) => f.id);
  result.moved = items.filter((f) => {
    const s = start.get(f.id)!;
    const g = d.furniture.find((x) => x.id === f.id)!;
    return Math.abs(g.x - s.x) > 1e-9 || Math.abs(g.y - s.y) > 1e-9;
  }).map((f) => f.id);
}

/**
 * Move one item along the axis towards `target` with the drag rules. Dragging slides
 * along slanted walls; arranging must not shift the other coordinate, and the mm
 * rounding must not create a hairline overlap – in both cases a straight sweep along
 * the axis (same obstacles) finds the last free spot instead.
 */
function moveAlong(d: Project, derived: DerivedPlan, obstacles: Obstacle[], id: string, axis: DistributeAxis, target: number) {
  const f = d.furniture.find((x) => x.id === id);
  if (!f || f.locked) return;
  const before = { ...f };
  const goal = axis === 'x' ? { x: mm(target), y: f.y } : { x: f.x, y: mm(target) };
  const col = moveCollision(d, before, obstacles);
  // obstacles the item already overlaps (placed with Alt) do not hold it back, as when dragging
  const stuck = new Set(collidingObstacles(col.pose, col.obstacles));
  const relevant = col.obstacles.filter((o) => !stuck.has(o));
  const hits = (x: number, y: number) => collidingObstacles({ ...col.pose, x, y }, relevant).length > 0;
  moveFurnitureTo(d, derived, obstacles, id, goal, { snap: false, collide: true });
  const drift = axis === 'x' ? Math.abs(f.y - before.y) : Math.abs(f.x - before.x);
  if (drift <= 1e-9 && !hits(f.x, f.y)) return;
  // straight sweep along the axis: last free position before the first contact
  const from = axis === 'x' ? before.x : before.y;
  const to = axis === 'x' ? goal.x : goal.y;
  const at = (v: number) => (axis === 'x' ? { x: v, y: before.y } : { x: before.x, y: v });
  const free = (v: number) => {
    const p = at(v);
    return !hits(p.x, p.y);
  };
  const step = 0.005;
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / step));
  let ok = from;
  let bad: number | null = null;
  for (let i = 1; i <= n; i++) {
    const v = from + ((to - from) * i) / n;
    if (!free(v)) {
      bad = v;
      break;
    }
    ok = v;
  }
  if (bad !== null) {
    let hit: number = bad;
    for (let k = 0; k < 30; k++) {
      const mid = (ok + hit) / 2;
      if (free(mid)) ok = mid;
      else hit = mid;
    }
  }
  // round to mm towards the start so the rounded spot is still free
  const dir = Math.sign(to - from);
  let v = dir > 0 ? Math.floor(ok * 1000) / 1000 : Math.ceil(ok * 1000) / 1000;
  if ((v - from) * dir < 0 || !free(v)) v = from;
  const p = at(v);
  f.x = p.x;
  f.y = p.y;
}
