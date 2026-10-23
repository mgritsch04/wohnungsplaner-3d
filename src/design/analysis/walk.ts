/**
 * Ways through one room (#438): a grid over the room with the clearance of every cell (distance
 * to the nearest wall or obstacle), shortest ways of a given width on it, and the check whether
 * the ways of the empty room still exist in the furnished room (B1–B3 of the walk-through).
 *
 * Unlike `model/walkPath.ts` (whole flat, one body width, rebuilt per query) the grid covers one
 * room and is built once; any width is a threshold on the clearance, so every way of a room
 * costs only an A* search. Clearance comes from an exact Euclidean distance transform over the
 * blocked cells (outside the room or inside an obstacle).
 */
import { add, dist, scale, type Vec2 } from '../../model/vec';
import type { RoomAnalysis } from '../types';

export interface WalkGrid {
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
  /** Distance from each cell centre to the nearest wall or obstacle (m); 0 for blocked cells. */
  clear: Float32Array;
}

/** Cells along a horizontal line inside a polygon (even-odd rule), as [first, last] cell index pairs. */
function rowSpans(poly: Vec2[], y: number, x0: number, cell: number, nx: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a.y <= y === b.y <= y) continue;
    xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) {
    // cells whose centre lies between the two crossings
    const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5));
    const i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
    if (i1 >= i0) out.push([i0, i1]);
  }
  return out;
}

/** 1-D squared distance transform (Felzenszwalb and Huttenlocher) of `f` into `d`. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

const FAR = 1e20;

/** Grid over the room `polygon`; `obstacles` (footprints of pieces one cannot walk through) block too. */
export function walkGrid(polygon: Vec2[], obstacles: Vec2[][] = [], cell = 0.05): WalkGrid {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x0 = minX - cell;
  const y0 = minY - cell;
  const nx = Math.ceil((maxX - x0) / cell) + 2;
  const ny = Math.ceil((maxY - y0) / cell) + 2;
  const f = new Float64Array(nx * ny); // 0 = blocked, FAR = free
  for (let j = 0; j < ny; j++) for (const [i0, i1] of rowSpans(polygon, y0 + (j + 0.5) * cell, x0, cell, nx)) f.fill(FAR, j * nx + i0, j * nx + i1 + 1);
  for (const o of obstacles) {
    const oy0 = Math.min(...o.map((p) => p.y));
    const oy1 = Math.max(...o.map((p) => p.y));
    for (let j = Math.max(0, Math.floor((oy0 - y0) / cell)); j <= Math.min(ny - 1, Math.ceil((oy1 - y0) / cell)); j++)
      for (const [i0, i1] of rowSpans(o, y0 + (j + 0.5) * cell, x0, cell, nx)) f.fill(0, j * nx + i0, j * nx + i1 + 1);
  }
  // squared distance in cells: columns, then rows
  const n = Math.max(nx, ny);
  const fi = new Float64Array(n);
  const di = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) fi[j] = f[j * nx + i];
    edt1d(fi, ny, di, v, z);
    for (let j = 0; j < ny; j++) f[j * nx + i] = di[j];
  }
  const clear = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) fi[i] = f[j * nx + i];
    edt1d(fi, nx, di, v, z);
    // the nearest blocked cell centre is about half a cell behind the actual edge
    for (let i = 0; i < nx; i++) clear[j * nx + i] = di[i] > 0 ? Math.max(0, Math.sqrt(di[i]) * cell - cell / 2) : 0;
  }
  return { x0, y0, cell, nx, ny, clear };
}

const cellCenter = (g: WalkGrid, k: number): Vec2 => ({ x: g.x0 + ((k % g.nx) + 0.5) * g.cell, y: g.y0 + (Math.floor(k / g.nx) + 0.5) * g.cell });

function cellAt(g: WalkGrid, p: Vec2): number {
  const i = Math.floor((p.x - g.x0) / g.cell);
  const j = Math.floor((p.y - g.y0) / g.cell);
  return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? -1 : j * g.nx + i;
}

/** Clearance at a point (m); 0 outside the grid. */
export function clearanceAt(g: WalkGrid, p: Vec2): number {
  const k = cellAt(g, p);
  return k < 0 ? 0 : g.clear[k];
}

/** Nearest cell with at least `r` clearance within `maxDist` of `p`. */
function nearestFree(g: WalkGrid, p: Vec2, r: number, maxDist: number): number {
  const k0 = cellAt(g, p);
  if (k0 >= 0 && g.clear[k0] >= r) return k0;
  const ci = Math.floor((p.x - g.x0) / g.cell);
  const cj = Math.floor((p.y - g.y0) / g.cell);
  const R = Math.ceil(maxDist / g.cell);
  let best = -1;
  let bestD = Infinity;
  for (let j = Math.max(0, cj - R); j <= Math.min(g.ny - 1, cj + R); j++)
    for (let i = Math.max(0, ci - R); i <= Math.min(g.nx - 1, ci + R); i++) {
      const k = j * g.nx + i;
      if (g.clear[k] < r) continue;
      const d = dist(cellCenter(g, k), p);
      if (d <= maxDist && d < bestD) {
        best = k;
        bestD = d;
      }
    }
  return best;
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
    for (let i = a.length - 1; i > 0; ) {
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
      for (let i = 0; ; ) {
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

/** A* over cells with clearance ≥ r, 8 neighbours without cutting corners. */
function aStar(g: WalkGrid, s: number, t: number, r: number): number[] | null {
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < g.nx && j < g.ny && g.clear[j * g.nx + i] >= r;
  const gs = new Float64Array(g.nx * g.ny).fill(Infinity);
  const from = new Int32Array(g.nx * g.ny).fill(-1);
  const closed = new Uint8Array(g.nx * g.ny);
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
        if ((!di && !dj) || !free(i + di, j + dj)) continue;
        if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue;
        const nk = (j + dj) * g.nx + i + di;
        const cand = gs[k] + (di && dj ? Math.SQRT2 : 1);
        if (cand < gs[nk]) {
          gs[nk] = cand;
          from[nk] = k;
          heap.push(nk, cand + h(nk));
        }
      }
  }
  if (s !== t && from[t] === -1) return null;
  const path = [t];
  while (path[path.length - 1] !== s) path.push(from[path[path.length - 1]]);
  return path.reverse();
}

/** The straight line from p to q keeps clearance ≥ r (sampled at a quarter cell). */
function lineOfSight(g: WalkGrid, p: Vec2, q: Vec2, r: number): boolean {
  const steps = Math.max(1, Math.ceil(dist(p, q) / (g.cell / 4)));
  for (let s = 0; s <= steps; s++) {
    const k = cellAt(g, { x: p.x + ((q.x - p.x) * s) / steps, y: p.y + ((q.y - p.y) * s) / steps });
    if (k < 0 || g.clear[k] < r) return false;
  }
  return true;
}

/**
 * Shortest way of `width` from `a` to `b`: the centre line keeps half the width to walls and
 * obstacles. Start and end snap to the nearest cell with enough room within `snap` metres.
 */
export function walkRoute(g: WalkGrid, a: Vec2, b: Vec2, width: number, snap = 0.35): { path: Vec2[]; length: number } | null {
  const r = width / 2;
  const s = nearestFree(g, a, r, snap);
  const t = s < 0 ? -1 : nearestFree(g, b, r, snap);
  if (t < 0) return null;
  const cells = aStar(g, s, t, r);
  if (!cells) return null;
  const pts = cells.map((k) => cellCenter(g, k));
  const smooth = [pts[0]];
  for (let i = 0; i < pts.length - 1; ) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineOfSight(g, pts[i], pts[j], r)) j--;
    smooth.push(pts[j]);
    i = j;
  }
  let length = 0;
  for (let i = 1; i < smooth.length; i++) length += dist(smooth[i - 1], smooth[i]);
  return { path: smooth, length };
}

/** Widths tried when the full width does not fit, down to a narrow passage. */
export const FALLBACK_WIDTHS = [0.8, 0.7, 0.6, 0.5];

/** End of a way at an opening: the middle of the opening on the wall face, and the way into the room. */
export interface WayEnd {
  face: Vec2;
  inward: Vec2;
}

/** Ends of the ways at the passable openings of a room, by label (T1 …). */
export function wayEnds(room: Pick<RoomAnalysis, 'walls'>): Map<string, WayEnd> {
  const out = new Map<string, WayEnd>();
  for (const w of room.walls) for (const o of w.openings) if (o.passable) out.set(o.id, { face: add(w.a, scale(w.dir, (o.t0 + o.t1) / 2)), inward: w.inward });
  return out;
}

/** Way between two openings with the widest width that fits, starting with `width`. */
export function widestRoute(g: WalkGrid, from: WayEnd, to: WayEnd, width: number): { path: Vec2[]; length: number; width: number } | null {
  for (const w of [width, ...FALLBACK_WIDTHS.filter((x) => x < width - 1e-9)]) {
    const inside = (e: WayEnd) => ({ x: e.face.x + e.inward.x * (w / 2 + 0.05), y: e.face.y + e.inward.y * (w / 2 + 0.05) });
    const res = walkRoute(g, inside(from), inside(to), w);
    if (!res) continue;
    const path = [from.face, ...res.path, to.face];
    return { path, length: res.length + dist(from.face, res.path[0]) + dist(res.path[res.path.length - 1], to.face), width: w };
  }
  return null;
}

/** A way of the empty room, measured again in the furnished room. */
export interface WalkCheck {
  from: string;
  to: string;
  /** Width the way needs (from the empty room). */
  width: number;
  /** Widest way that still fits (m), 0 when there is no way at all. */
  fits: number;
  /** Way of the needed width, else of the widest width that fits; empty when blocked. */
  path: Vec2[];
  length: number;
  /** Length in the empty room. */
  emptyLength: number;
  main: boolean;
}

/**
 * Checks the ways of a room again with furniture: `obstacles` are the footprints of every piece
 * one cannot walk through (existing ones included; rugs, curtains and hanging pieces left out).
 */
export function checkWalkways(room: Pick<RoomAnalysis, 'polygon' | 'walls' | 'walkways'>, obstacles: Vec2[][]): WalkCheck[] {
  const g = walkGrid(room.polygon, obstacles);
  const ends = wayEnds(room);
  return room.walkways.map((w) => {
    const route = widestRoute(g, ends.get(w.from)!, ends.get(w.to)!, w.width);
    return {
      from: w.from,
      to: w.to,
      width: w.width,
      fits: route?.width ?? 0,
      path: route?.path ?? [],
      length: route?.length ?? Infinity,
      emptyLength: w.length,
      main: w.main,
    };
  });
}
