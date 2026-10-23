/**
 * Walking grid of a room (#441): where one can stand with a given clear radius, shortest walks
 * (A*) and what can be reached from the doors. Grid cell 5 cm (10 cm in big rooms).
 */
import { pointInPolygon, type Vec2 } from '../../model/vec';
import { boundaryDist, bounds } from './geom';
import type { RItem } from './items';

export interface Walk {
  length: number;
  points: Vec2[];
}

export class WalkGrid {
  readonly cell: number;
  readonly x0: number;
  readonly y0: number;
  readonly nx: number;
  readonly ny: number;
  private readonly inside: Uint8Array;
  private readonly obstacleDist: Float32Array;
  private readonly wallDist: Float32Array;
  private readonly doorNear: Uint8Array;
  private readonly masks = new Map<number, Uint8Array>();

  /**
   * @param obstacles pieces that block walking
   * @param doorMids door and passage centres on the wall: near them the wall does not narrow the walk
   */
  constructor(
    readonly poly: Vec2[],
    obstacles: RItem[],
    doorMids: Vec2[],
  ) {
    const b = bounds(poly);
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    this.cell = area > 45 ? 0.1 : 0.05;
    this.x0 = b.x0;
    this.y0 = b.y0;
    this.nx = Math.ceil((b.x1 - b.x0) / this.cell) + 1;
    this.ny = Math.ceil((b.y1 - b.y0) / this.cell) + 1;
    const n = this.nx * this.ny;
    this.inside = new Uint8Array(n);
    this.obstacleDist = new Float32Array(n).fill(9);
    this.wallDist = new Float32Array(n).fill(9);
    this.doorNear = new Uint8Array(n);
    const boxes = obstacles.map((o) => {
      const c = Math.cos(o.rotation);
      const s = Math.sin(o.rotation);
      return { o, c, s, hw: o.width / 2, hd: o.depth / 2, reach: Math.hypot(o.width, o.depth) / 2 + 1.2 };
    });
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const p = this.centre(i, j);
        const k = j * this.nx + i;
        if (!pointInPolygon(p, poly)) continue;
        this.inside[k] = 1;
        this.wallDist[k] = boundaryDist(p, poly);
        let best = 9;
        for (const bx of boxes) {
          const dx = p.x - bx.o.x;
          const dy = p.y - bx.o.y;
          if (Math.abs(dx) > bx.reach || Math.abs(dy) > bx.reach) continue;
          const lu = Math.abs(dx * bx.c + dy * bx.s);
          const lv = Math.abs(-dx * bx.s + dy * bx.c);
          best = Math.min(best, Math.hypot(Math.max(lu - bx.hw, 0), Math.max(lv - bx.hd, 0)));
        }
        this.obstacleDist[k] = best;
        if (doorMids.some((m) => Math.hypot(m.x - p.x, m.y - p.y) < 0.8)) this.doorNear[k] = 1;
      }
  }

  centre(i: number, j: number): Vec2 {
    return { x: this.x0 + i * this.cell, y: this.y0 + j * this.cell };
  }

  private cellOf(p: Vec2): [number, number] {
    return [Math.round((p.x - this.x0) / this.cell), Math.round((p.y - this.y0) / this.cell)];
  }

  /** Cells where a walker with this clear radius (half the width of the walk) fits. */
  mask(radius: number): Uint8Array {
    const key = Math.round(radius * 1000);
    let m = this.masks.get(key);
    if (!m) {
      m = new Uint8Array(this.inside.length);
      for (let k = 0; k < m.length; k++) m[k] = this.inside[k] && this.obstacleDist[k] >= radius - 0.012 && (this.wallDist[k] >= radius - 0.012 || this.doorNear[k]) ? 1 : 0;
      this.masks.set(key, m);
    }
    return m;
  }

  /** Nearest free cell within `reach` of a point, or -1. */
  private snap(p: Vec2, mask: Uint8Array, reach = 0.5): number {
    const [ci, cj] = this.cellOf(p);
    const r = Math.ceil(reach / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let j = Math.max(0, cj - r); j <= Math.min(this.ny - 1, cj + r); j++)
      for (let i = Math.max(0, ci - r); i <= Math.min(this.nx - 1, ci + r); i++) {
        const k = j * this.nx + i;
        if (!mask[k]) continue;
        const d = Math.hypot(i - ci, j - cj);
        if (d < bestD && d * this.cell <= reach) {
          bestD = d;
          best = k;
        }
      }
    return best;
  }

  /** Shortest walk between two points with a clear radius, or null. */
  walk(from: Vec2, to: Vec2, radius: number): Walk | null {
    const mask = this.mask(radius);
    const s = this.snap(from, mask);
    const t = this.snap(to, mask);
    if (s < 0 || t < 0) return null;
    const n = mask.length;
    const g = new Float32Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const tx = t % this.nx;
    const ty = Math.floor(t / this.nx);
    const h = (k: number) => {
      const dx = Math.abs((k % this.nx) - tx);
      const dy = Math.abs(Math.floor(k / this.nx) - ty);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const heap = new MinHeap();
    g[s] = 0;
    heap.push(h(s), s);
    while (heap.size) {
      const k = heap.pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === t) break;
      const ki = k % this.nx;
      const kj = (k - ki) / this.nx;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ki + di;
          const nj = kj + dj;
          if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.ny) continue;
          const nk = nj * this.nx + ni;
          if (!mask[nk] || closed[nk]) continue;
          if (di && dj && (!mask[kj * this.nx + ni] || !mask[nj * this.nx + ki])) continue;
          const ng = g[k] + (di && dj ? Math.SQRT2 : 1);
          if (ng < g[nk]) {
            g[nk] = ng;
            prev[nk] = k;
            heap.push(ng + h(nk), nk);
          }
        }
    }
    if (!closed[t]) return null;
    const points: Vec2[] = [];
    for (let k = t; k >= 0; k = prev[k]) points.push(this.centre(k % this.nx, Math.floor(k / this.nx)));
    points.reverse();
    return { length: g[t] * this.cell, points };
  }

  /** Cells one can reach from the given points with a clear radius. */
  reachable(starts: Vec2[], radius: number): Uint8Array {
    const mask = this.mask(radius);
    const seen = new Uint8Array(mask.length);
    const stack: number[] = [];
    for (const p of starts) {
      const k = this.snap(p, mask);
      if (k >= 0 && !seen[k]) {
        seen[k] = 1;
        stack.push(k);
      }
    }
    while (stack.length) {
      const k = stack.pop()!;
      const ki = k % this.nx;
      const kj = (k - ki) / this.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ki + di;
        const nj = kj + dj;
        if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.ny) continue;
        const nk = nj * this.nx + ni;
        if (mask[nk] && !seen[nk]) {
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    return seen;
  }

  /** Whether a reachable cell lies within `reach` of the point. */
  touches(seen: Uint8Array, p: Vec2, reach: number): boolean {
    const [ci, cj] = this.cellOf(p);
    const r = Math.ceil(reach / this.cell);
    for (let j = Math.max(0, cj - r); j <= Math.min(this.ny - 1, cj + r); j++)
      for (let i = Math.max(0, ci - r); i <= Math.min(this.nx - 1, ci + r); i++)
        if (seen[j * this.nx + i] && Math.hypot(i - ci, j - cj) * this.cell <= reach) return true;
    return false;
  }
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [keys[p], keys[i]] = [keys[i], keys[p]];
      [vals[p], vals[i]] = [vals[i], vals[p]];
      i = p;
    }
  }
  pop(): number {
    const { keys, vals } = this;
    const top = vals[0];
    const lk = keys.pop()!;
    const lv = vals.pop()!;
    if (keys.length) {
      keys[0] = lk;
      vals[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < keys.length && keys[l] < keys[m]) m = l;
        if (r < keys.length && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [keys[m], keys[i]] = [keys[i], keys[m]];
        [vals[m], vals[i]] = [vals[i], vals[m]];
        i = m;
      }
    }
    return top;
  }
}
