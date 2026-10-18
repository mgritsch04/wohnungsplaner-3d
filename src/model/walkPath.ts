/**
 * Shortest walking path (#67)
 * ---------------------------
 * `shortestWalkPath(project, derived, a, b)` finds the shortest way a person can
 * walk from `a` to `b` and returns it as a polyline with its length.
 *
 * Algorithm: grid A* (5 cm cells, 8 neighbours, no corner cutting) on a clearance
 * map, followed by string pulling (line-of-sight smoothing).
 * Why a grid and not a visibility graph: the walkable area is "room interiors and
 * open door gaps, minus everything closer than the body radius to a wall or a piece
 * of furniture". On a grid that inflation is a simple per-cell distance test, works
 * for any room shape and for overlapping/rotated furniture without polygon offsetting
 * and union. A visibility graph would need exactly those robust polygon operations.
 * 5 cm cells keep the error of the smoothed path in the low centimetre range, and an
 * apartment is only a few 10 000 cells, so a search takes a few milliseconds.
 *
 * Obstacles:
 * - Walls. Doorless passages and OPEN doors (`opening.open`) are gaps in the wall;
 *   closed doors and windows are wall.
 * - Furniture by the same rules as the narrow-passage check (#68): rugs/curtains,
 *   flat items and items hung above HANGING_ELEVATION are not obstacles.
 * - Everything is inflated by the body radius (default 25 cm), so the path keeps a
 *   realistic distance to edges instead of sticking to them.
 * Only room interiors and door gaps are walkable – the path never leaves the flat.
 * The opened door leaf itself is not an obstacle (it stands against the wall).
 */
import type { DerivedPlan } from './derived';
import { clipFootprint } from './geometry/walls';
import { furnitureFootprint, isPassageObstacle } from './passages';
import { isGlassDoor, type Opening, type Project } from './schema';
import { add, closestPointOnSegment, dist, pointInPolygon, scale, type Vec2 } from './vec';

export interface WalkPathOptions {
  /** Body radius in metres (clearance to walls and furniture). */
  radius?: number;
  /** Grid cell size in metres. */
  cell?: number;
}

export type WalkPathResult =
  | { ok: true; points: Vec2[]; length: number }
  | { ok: false; reason: string };

interface Grid {
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
  free: Uint8Array;
}

/** Which parts block: walls with closed doors, furniture. Relaxed variants explain a failure. */
interface ObstacleMode {
  closedDoorsBlock: boolean;
  furnitureBlocks: boolean;
}

const passable = (o: Opening) => o.kind === 'passage' || ((o.kind === 'door' || isGlassDoor(o)) && o.open);

function buildGrid(project: Project, derived: DerivedPlan, radius: number, cell: number, mode: ObstacleMode): Grid | null {
  const rooms = [...derived.rooms.values()].map((g) => g.interior);
  if (rooms.length === 0) return null;
  // walkable domain: room interiors + gaps of passable openings (across the wall thickness)
  const gaps: Vec2[][] = [];
  const solids: Vec2[][] = [];
  for (const w of project.walls) {
    const fp = derived.footprints.get(w.id);
    if (!fp) continue;
    let cursor = -Infinity;
    for (const r of derived.openings.get(w.id) ?? []) {
      const open = mode.closedDoorsBlock ? passable(r.opening) : r.opening.kind !== 'window' || isGlassDoor(r.opening);
      if (!open) continue;
      solids.push(clipFootprint(fp, cursor, r.s0));
      cursor = r.s1;
      const h = scale(fp.normal, fp.thickness / 2 + cell);
      const p0 = add(fp.a, scale(fp.dir, r.s0));
      const p1 = add(fp.a, scale(fp.dir, r.s1));
      gaps.push([add(p0, h), add(p1, h), add(p1, scale(h, -1)), add(p0, scale(h, -1))]);
    }
    solids.push(clipFootprint(fp, cursor, Infinity));
  }
  for (const h of derived.hubs) solids.push(h.polygon);
  const obstacles = solids.filter((s) => s.length >= 3);
  if (mode.furnitureBlocks) for (const f of project.furniture) if (isPassageObstacle(f)) obstacles.push(furnitureFootprint(f));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of [...rooms, ...gaps])
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  const x0 = minX - cell;
  const y0 = minY - cell;
  const nx = Math.ceil((maxX - x0) / cell) + 2;
  const ny = Math.ceil((maxY - y0) / cell) + 2;
  const free = new Uint8Array(nx * ny);
  const center = (i: number, j: number): Vec2 => ({ x: x0 + (i + 0.5) * cell, y: y0 + (j + 0.5) * cell });

  // 1) domain
  for (const poly of [...rooms, ...gaps]) {
    const [i0, j0, i1, j1] = cellRange(poly, 0, x0, y0, cell, nx, ny);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!free[j * nx + i] && pointInPolygon(center(i, j), poly)) free[j * nx + i] = 1;
  }
  // 2) inflated obstacles
  for (const poly of obstacles) {
    const [i0, j0, i1, j1] = cellRange(poly, radius, x0, y0, cell, nx, ny);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (!free[k]) continue;
        const c = center(i, j);
        if (pointInPolygon(c, poly) || distToPolygonEdges(c, poly) < radius) free[k] = 0;
      }
  }
  return { x0, y0, cell, nx, ny, free };
}

function cellRange(poly: Vec2[], pad: number, x0: number, y0: number, cell: number, nx: number, ny: number): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const clampI = (v: number) => Math.max(0, Math.min(nx - 1, v));
  const clampJ = (v: number) => Math.max(0, Math.min(ny - 1, v));
  return [clampI(Math.floor((minX - pad - x0) / cell)), clampJ(Math.floor((minY - pad - y0) / cell)), clampI(Math.ceil((maxX + pad - x0) / cell)), clampJ(Math.ceil((maxY + pad - y0) / cell))];
}

function distToPolygonEdges(p: Vec2, poly: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, closestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]).distance);
  return d;
}

const cellOf = (g: Grid, p: Vec2): [number, number] => [Math.floor((p.x - g.x0) / g.cell), Math.floor((p.y - g.y0) / g.cell)];
const isFree = (g: Grid, i: number, j: number) => i >= 0 && j >= 0 && i < g.nx && j < g.ny && g.free[j * g.nx + i] === 1;
const cellCenter = (g: Grid, k: number): Vec2 => ({ x: g.x0 + ((k % g.nx) + 0.5) * g.cell, y: g.y0 + (Math.floor(k / g.nx) + 0.5) * g.cell });

/** Nearest free cell to `p` within `maxDist` (a click a little too close to a wall or onto furniture). */
function nearestFree(g: Grid, p: Vec2, maxDist: number): number | null {
  const [ci, cj] = cellOf(g, p);
  if (isFree(g, ci, cj)) return cj * g.nx + ci;
  const R = Math.ceil(maxDist / g.cell);
  let bestK = -1;
  let bestD = Infinity;
  for (let r = 1; r <= R; r++) {
    for (let j = cj - r; j <= cj + r; j++)
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !isFree(g, i, j)) continue;
        const k = j * g.nx + i;
        const d = dist(cellCenter(g, k), p);
        if (d <= maxDist && d < bestD) {
          bestK = k;
          bestD = d;
        }
      }
    if (bestK >= 0 && bestD <= r * g.cell) break;
  }
  return bestK >= 0 ? bestK : null;
}

/** Binary min-heap of cell indices keyed by f-score. */
class Heap {
  private k: number[] = [];
  private f: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, f: number) {
    const a = this.k;
    const b = this.f;
    a.push(key);
    b.push(f);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (b[p] <= b[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [b[p], b[i]] = [b[i], b[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.k;
    const b = this.f;
    const top = a[0];
    const lk = a.pop()!;
    const lf = b.pop()!;
    if (a.length) {
      a[0] = lk;
      b[0] = lf;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [b[m], b[i]] = [b[i], b[m]];
        i = m;
      }
    }
    return top;
  }
}

function aStar(g: Grid, s: number, t: number): number[] | null {
  const n = g.nx * g.ny;
  const gs = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const ti = t % g.nx;
  const tj = Math.floor(t / g.nx);
  const h = (k: number) => {
    const dx = Math.abs((k % g.nx) - ti);
    const dy = Math.abs(Math.floor(k / g.nx) - tj);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new Heap();
  gs[s] = 0;
  heap.push(s, h(s));
  while (heap.size) {
    const k = heap.pop();
    if (closed[k]) continue;
    if (k === t) break;
    closed[k] = 1;
    const i = k % g.nx;
    const j = Math.floor(k / g.nx);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (!isFree(g, ni, nj)) continue;
        // diagonal steps only when both orthogonal neighbours are free (no corner cutting)
        if (di && dj && (!isFree(g, i + di, j) || !isFree(g, i, j + dj))) continue;
        const nk = nj * g.nx + ni;
        const cand = gs[k] + (di && dj ? Math.SQRT2 : 1);
        if (cand < gs[nk]) {
          gs[nk] = cand;
          from[nk] = k;
          heap.push(nk, cand + h(nk));
        }
      }
  }
  if (from[t] === -1 && s !== t) return null;
  const path = [t];
  while (path[path.length - 1] !== s) path.push(from[path[path.length - 1]]);
  return path.reverse();
}

/** Straight segment stays on free cells (sampled at a quarter cell). */
function lineOfSight(g: Grid, p: Vec2, q: Vec2): boolean {
  const L = dist(p, q);
  const steps = Math.max(1, Math.ceil(L / (g.cell / 4)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const [i, j] = cellOf(g, { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    if (!isFree(g, i, j)) return false;
  }
  return true;
}

/** String pulling: keep only the points where the straight line of sight breaks. */
function smooth(g: Grid, pts: Vec2[]): Vec2[] {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineOfSight(g, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

function search(project: Project, derived: DerivedPlan, a: Vec2, b: Vec2, radius: number, cell: number, mode: ObstacleMode): WalkPathResult {
  const g = buildGrid(project, derived, radius, cell, mode);
  if (!g) return { ok: false, reason: 'Kein Weg gefunden (keine Räume im Plan)' };
  const snapDist = radius + 0.4;
  const s = nearestFree(g, a, snapDist);
  if (s === null) return { ok: false, reason: 'Kein Weg gefunden (Start liegt nicht in einem begehbaren Bereich)' };
  const t = nearestFree(g, b, snapDist);
  if (t === null) return { ok: false, reason: 'Kein Weg gefunden (Ziel liegt nicht in einem begehbaren Bereich)' };
  const cells = aStar(g, s, t);
  if (!cells) return { ok: false, reason: 'Kein Weg gefunden' };
  // the clicked points when they are walkable, else the nearest walkable cell
  const [ai, aj] = cellOf(g, a);
  const [bi, bj] = cellOf(g, b);
  const start = isFree(g, ai, aj) ? a : cellCenter(g, s);
  const goal = isFree(g, bi, bj) ? b : cellCenter(g, t);
  const raw = [start, ...cells.slice(1, -1).map((k) => cellCenter(g, k)), goal];
  const points = raw.length > 2 ? smooth(g, raw) : raw;
  let length = 0;
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i]);
  return { ok: true, points, length };
}

export function shortestWalkPath(project: Project, derived: DerivedPlan, a: Vec2, b: Vec2, opts: WalkPathOptions = {}): WalkPathResult {
  const radius = opts.radius ?? 0.25;
  const cell = opts.cell ?? 0.05;
  const res = search(project, derived, a, b, radius, cell, { closedDoorsBlock: true, furnitureBlocks: true });
  if (res.ok || res.reason !== 'Kein Weg gefunden') return res;
  // explain what blocks: retry with relaxed obstacles (only on failure)
  if (search(project, derived, a, b, radius, cell, { closedDoorsBlock: false, furnitureBlocks: true }).ok)
    return { ok: false, reason: 'Kein Weg gefunden (blockiert durch eine geschlossene Tür)' };
  if (search(project, derived, a, b, radius, cell, { closedDoorsBlock: false, furnitureBlocks: false }).ok)
    return { ok: false, reason: 'Kein Weg gefunden (blockiert durch Möbel)' };
  return { ok: false, reason: 'Kein Weg gefunden (blockiert durch Wände oder zu schmale Durchgänge)' };
}

/** "7,40 m" */
export function formatWalkLength(m: number): string {
  return `${m.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}
